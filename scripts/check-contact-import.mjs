import assert from 'node:assert/strict';
import {parseVCardContacts,prepareContactImport} from '../lib/contact-import.js';
import {mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PGlite} from '@electric-sql/pglite';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {runContactImport} from './import-contacts.mjs';

const card=lines=>`BEGIN:VCARD\r\nVERSION:3.0\r\n${lines}\r\nEND:VCARD\r\n`;
const basic=card('FN:Cliente Exemplo\r\nTEL:+55 (11) 99999-0001');
assert.deepEqual(parseVCardContacts(basic),{contacts:[{name:'Cliente Exemplo',phone:'11999990001'}],rejected:[],duplicates:0,totalCards:1});
const variants=card('FN:  Ágata\\, Exemplo\\; Jr.\r\n item folded\r\nTEL;TYPE=HOME:1133330001\r\nitem1.TEL;TYPE=CELL:tel:+55-11-99999-0002')+
 card('N:Família;Pessoa;Meio;Dra.;Filha\r\nTEL;TYPE=CELL:123\r\nitem2.TEL:11999990003')+
 card('FN:\r\nN:Outro;Nome;;;\r\nTEL;TYPE=VOICE:1133330004\r\nTEL;TYPE=WHATSAPP:11999990004');
assert.deepEqual(parseVCardContacts(variants).contacts,[
 {name:'Ágata, Exemplo; Jr.item folded',phone:'11999990002'},
 {name:'Dra. Pessoa Meio Família Filha',phone:'11999990003'},
 {name:'Nome Outro',phone:'11999990004'}
]);
assert.deepEqual(parseVCardContacts(card('N:Família\\\\;Pessoa;;;\nTEL:5533330001')).contacts,[{name:'Pessoa Família\\',phone:'5533330001'}],'An escaped backslash does not escape the next structured-name delimiter or remove domestic area code 55');
const duplicate=basic+card('FN: cliente   exemplo \nTEL:11999990001')+card('FN:Outra Pessoa\nTEL:11999990001');
assert.equal(parseVCardContacts(duplicate).duplicates,1);
assert.equal(parseVCardContacts(duplicate).contacts.length,2,'Household phones do not merge different people');
const invalid=card('FN:Sem Telefone')+card('TEL:11999990005')+card('FN:12345\nTEL:11999990006')+card('FN:Inválido\nTEL:123')+card('FN:Inválido\nTEL:12345678901234');
assert.deepEqual(parseVCardContacts(invalid).rejected,[{index:1,reason:'invalid-phone'},{index:2,reason:'invalid-name'},{index:3,reason:'invalid-name'},{index:4,reason:'invalid-phone'},{index:5,reason:'invalid-phone'}]);
assert.throws(()=>parseVCardContacts('BEGIN:VCARD\nFN:Incompleto'),/vCard/i);
assert.throws(()=>parseVCardContacts('not a card'),/vCard/i);
assert.deepEqual(parseVCardContacts(''),{contacts:[],rejected:[],duplicates:0,totalCards:0});

const original={clients:[{id:'old',name:'CLIENTE EXEMPLO',phone:'+55 11 99999-0001',notes:'Antiga',anamnesis:{allergies:'Teste'}}],appointments:[{id:'a1',clientId:'old',treatmentNotes:'Histórico'}],transactions:[{id:'t1'}],services:[],settings:{start:'08:00'},finance:{custom:['kept']},custom:{preserved:true}};
const snapshot=structuredClone(original);
const imported=prepareContactImport(original,duplicate+card('FN:Cliente Novo\nTEL:11999990007'),()=> 'new-id');
assert.deepEqual(original,snapshot,'Preparing an import cannot mutate the original account');
assert.deepEqual(imported.data.clients,[...snapshot.clients,{id:'new-id',name:'Outra Pessoa',phone:'11999990001',notes:''},{id:'new-id-2',name:'Cliente Novo',phone:'11999990007',notes:''}]);
assert.deepEqual({...imported.data,clients:[]},{...snapshot,clients:[]},'Every non-client field is preserved exactly');
assert.deepEqual(imported.report,{totalCards:4,validContacts:3,added:2,duplicates:2,rejected:0,clientsBefore:1,clientsAfter:3});
const repeated=prepareContactImport(imported.data,duplicate+card('FN:Cliente Novo\nTEL:11999990007'));
assert.equal(repeated.report.added,0);
assert.deepEqual(repeated.data,imported.data,'Repeat imports are idempotent');
assert.throws(()=>prepareContactImport({clients:Array.from({length:25000},(_,i)=>({id:String(i),name:'Existing',phone:'11999990008'}))},basic),/25000/);
assert.throws(()=>prepareContactImport({clients:null},basic));
const directory=await mkdtemp(join(tmpdir(),'podo-contact-synthetic-'));
const db=new PGlite();
await db.waitReady;
try {
 const source=join(directory,'synthetic.vcf');
 await writeFile(source,basic);
 const offline=await runContactImport({args:['--file',source],env:{},cwd:directory});
 assert.deepEqual(offline,{mode:'preview',database:false,totalCards:1,validContacts:1,duplicates:0,rejected:0});
 const child=spawnSync(process.execPath,[fileURLToPath(new URL('./import-contacts.mjs',import.meta.url)),'--file',source],{encoding:'utf8',env:{...process.env,DATABASE_URL:''}});
 assert.equal(child.status,0,child.stderr);
 assert.deepEqual(JSON.parse(child.stdout),offline,'The CLI prints only the aggregate report');
 await assert.rejects(()=>runContactImport({args:['--file',source,'--apply'],env:{},cwd:directory}),/DATABASE_URL/);
 await assert.rejects(()=>runContactImport({args:['--file',source,'--unexpected'],env:{},cwd:directory}));
 await db.exec('CREATE TABLE studio_accounts (id text PRIMARY KEY, username text, profile text, data jsonb, revision integer, updated_at timestamptz)');
 const stored={...snapshot,clients:[]};
 await db.query('INSERT INTO studio_accounts VALUES ($1,$2,$3,$4,7,NOW()),($5,$6,$7,$4,3,NOW())',['raquel-id','raquel','podo',JSON.stringify(stored),'personal-id','other','personal']);
 const sql=async (strings,...values)=>{
  const query=strings.reduce((text,part,index)=>text+(index?'$'+index:'')+part,'');
  return (await db.query(query,values)).rows;
 };
 const options={args:['--file',source],env:{DATABASE_URL:'postgres://synthetic:synthetic@localhost/local'},cwd:directory,sql};
 const preview=await runContactImport(options);
 assert.equal(preview.mode,'preview');assert.equal(preview.added,1);
 assert.equal((await db.query("SELECT revision FROM studio_accounts WHERE id='raquel-id'")).rows[0].revision,7);
 assert.deepEqual((await readdir(directory)).sort(),['synthetic.vcf'],'Preview writes no backup or account data');
 const saved=await runContactImport({...options,args:[...options.args,'--apply']});
 assert.equal(saved.saved,true);assert.equal(saved.verified,true);assert.equal(saved.revision,8);
 const rows=(await db.query('SELECT * FROM studio_accounts ORDER BY id')).rows;
 assert.deepEqual(rows[0].data,stored);assert.equal(rows[0].revision,3,'Personal account is untouched');
 assert.equal(rows[1].data.clients.length,1);assert.deepEqual({...rows[1].data,clients:[]},stored);
 const backups=await readdir(join(directory,'.browser-check'));
 assert.equal(backups.length,1);
 assert.deepEqual(JSON.parse(await readFile(join(directory,'.browser-check',backups[0]),'utf8')).data,stored);
 const repeat=await runContactImport({...options,args:[...options.args,'--apply']});
 assert.equal(repeat.added,0);assert.equal(repeat.revision,8);
 assert.equal((await readdir(join(directory,'.browser-check'))).length,1);
 let conflict=true;
 const raceSql=async (strings,...values)=>{
  if(conflict&&strings.join('').startsWith('UPDATE')){
   conflict=false;await db.query("UPDATE studio_accounts SET revision=revision+1 WHERE id='raquel-id'");
  }
  return sql(strings,...values);
 };
 await writeFile(source,card('FN:Segundo Cliente\nTEL:11999990009'));
 await assert.rejects(()=>runContactImport({...options,args:[...options.args,'--apply'],sql:raceSql}),/mudou/);
 assert.equal((await db.query("SELECT data FROM studio_accounts WHERE id='raquel-id'")).rows[0].data.clients.length,1,'Concurrent changes block the import');
 let wrote=false;
 const mismatchedRead=async (strings,...values)=>{
  const rows=await sql(strings,...values);
  if(strings.join('').startsWith('UPDATE'))wrote=true;
  if(wrote&&strings.join('').startsWith('SELECT data,'))rows[0].data.settings={changed:true};
  return rows;
 };
 await assert.rejects(()=>runContactImport({...options,args:[...options.args,'--apply'],sql:mismatchedRead}),/leitura posterior/);
 await db.query("DELETE FROM studio_accounts WHERE id='raquel-id'");
 await assert.rejects(()=>runContactImport(options),/Raquel/);
} finally {
 await db.close();await rm(directory,{recursive:true,force:true});
}
console.log('OK: contact parsing, validation, idempotency, history preservation, offline preview, scoped apply, private backup and concurrent-write protection.');
