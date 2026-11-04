import {randomUUID} from 'node:crypto';

const invalid=message=>{throw Object.assign(new Error(message),{code:'CONTACT_IMPORT_INVALID'});};
const cleanName=value=>String(value||'').replace(/[\s\u0000-\u001f\u007f]+/gu,' ').trim();
const validName=name=>name.length>0&&name.length<=200&&/\p{L}/u.test(name);
const unescape=value=>value.replace(/\\([nN,;\\])/g,(_,character)=>/[nN]/.test(character)?' ':character);
const normalizedName=value=>cleanName(value).normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase('pt-BR');
function canonicalPhone(value) {
 const source=String(value||'').replace(/^tel:/i,'').split(/;ext=|\?/i)[0].trim();
 if(!/^[+\d\s()./-]+$/.test(source))return '';
 let digits=source.replace(/\D/g,'');
 if(digits.length<10||digits.length>13)return '';
 if(digits.startsWith('55')&&(digits.length===12||digits.length===13))digits=digits.slice(2);
 return digits;
}
const identity=contact=>JSON.stringify([normalizedName(contact.name),canonicalPhone(contact.phone)]);
function structuredName(value) {
 const fields=[''];
 for(let index=0;index<value.length;index++) {
  if(value[index]==='\\'&&index+1<value.length)fields[fields.length-1]+=value[index]+value[++index];
  else if(value[index]===';')fields.push('');
  else fields[fields.length-1]+=value[index];
 }
 const parts=fields.map(part=>cleanName(unescape(part)));
 return cleanName([parts[3],parts[1],parts[2],parts[0],parts[4]].filter(Boolean).join(' '));
}

export function parseVCardContacts(text) {
 if(typeof text!=='string')invalid('O conteúdo vCard precisa ser texto.');
 const contacts=[],rejected=[],seen=new Set();
 let current=null,totalCards=0,duplicates=0;
 const lines=text.replace(/^\uFEFF/,'').replace(/\r\n|\r/g,'\n').replace(/\n[ \t]/g,'').split('\n');
 for(const line of lines) {
  if(/^BEGIN:VCARD$/i.test(line.trim())) {
   if(current)invalid('Arquivo vCard incompleto ou com cartões sobrepostos.');
   current=[];totalCards++;continue;
  }
  if(/^END:VCARD$/i.test(line.trim())) {
   if(!current)invalid('Arquivo vCard com fechamento sem início.');
   const properties=current.flatMap(entry=>{
    const colon=entry.indexOf(':');
    if(colon<0)return [];
    const [qualified,...parameters]=entry.slice(0,colon).split(';');
    const [field,...groups]=qualified.toUpperCase().split('.').reverse();
    return [{field,group:groups.join('.'),parameters:parameters.join(';').toUpperCase(),value:entry.slice(colon+1)}];
   });
   const names=properties.filter(property=>property.field==='FN').map(property=>cleanName(unescape(property.value)));
   const name=names.find(validName)||properties.filter(property=>property.field==='N').map(property=>structuredName(property.value)).find(validName)||'';
   if(!name)rejected.push({index:totalCards,reason:'invalid-name'});
   else {
    const phones=properties.filter(property=>property.field==='TEL').map((property,index)=>{
     const label=properties.filter(row=>row.group&&row.group===property.group&&row.field==='X-ABLABEL').map(row=>row.value).join(' ');
     const type=property.parameters+' '+label;
     return {phone:canonicalPhone(property.value),rank:/WHATSAPP/i.test(type)?3:/CELL|MOBILE/i.test(type)?2:/PREF/i.test(type)?1:0,index};
    }).filter(property=>property.phone).sort((a,b)=>b.rank-a.rank||a.index-b.index);
    if(!phones.length)rejected.push({index:totalCards,reason:'invalid-phone'});
    else {
     const contact={name,phone:phones[0].phone},key=identity(contact);
     if(seen.has(key))duplicates++;
     else {seen.add(key);contacts.push(contact);}
    }
   }
   current=null;continue;
  }
  if(current)current.push(line);
  else if(line.trim())invalid('O arquivo contém texto fora de um cartão vCard.');
 }
 if(current)invalid('Arquivo vCard incompleto.');
 return {contacts,rejected,duplicates,totalCards};
}

export function prepareContactImport(data,text,makeId=randomUUID) {
 if(!data||typeof data!=='object'||Array.isArray(data)||!Array.isArray(data.clients))invalid('A conta não contém uma lista de clientes válida.');
 const parsed=parseVCardContacts(text),copy=structuredClone(data),seen=new Set(copy.clients.map(identity));
 const ids=new Set(copy.clients.map(client=>client.id));
 let duplicates=parsed.duplicates,added=0;
 for(const contact of parsed.contacts) {
  const key=identity(contact);
  if(seen.has(key)){duplicates++;continue;}
  if(copy.clients.length>=25000)invalid('A importação ultrapassaria o limite de 25000 clientes.');
  const base=String(makeId()||'');
  if(!base)invalid('Não foi possível gerar um identificador de cliente.');
  let id=base,suffix=2;
  while(ids.has(id))id=base+'-'+suffix++;
  ids.add(id);seen.add(key);
  copy.clients.push({id,name:contact.name,phone:contact.phone,notes:''});added++;
 }
 if(copy.clients.length>25000)invalid('A conta ultrapassa o limite de 25000 clientes.');
 return {data:copy,report:{totalCards:parsed.totalCards,validContacts:parsed.contacts.length,added,duplicates,rejected:parsed.rejected.length,clientsBefore:data.clients.length,clientsAfter:copy.clients.length}};
}
