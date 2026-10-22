import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { test } from 'node:test';

const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
const source=[
  html.slice(html.indexOf('function field('),html.indexOf('function openService(')),
  html.slice(html.indexOf('function openClient('),html.indexOf('const categories=')),
  html.slice(html.indexOf('function renderHome('),html.indexOf('function renderAll('))
].join('\n');
const copy=value=>JSON.parse(JSON.stringify(value));

function fixture(){
  const elements=new Map(),alerts=[];let opened,sequence=0,saved=0;
  const element=id=>{
    if(!elements.has(id)){
      const classes=new Set();
      elements.set(id,{value:'',innerHTML:'',textContent:'',disabled:false,required:false,classList:{toggle(name,on){if(on)classes.add(name);else classes.delete(name)},contains:name=>classes.has(name)},querySelectorAll(){return []}});
    }
    return elements.get(id);
  };
  element('agendaDate').value='2026-10-22';
  const db={clients:[{id:'c1',name:'Ana',phone:'47999999999'}],services:[{id:'hands',name:'Duas mãos',duration:60,price:90},{id:'short',name:'Cuidado rápido',duration:30,price:40},{id:'long',name:'Sessão longa',duration:120,price:180}],appointments:[{id:'a1',clientId:'c1',serviceIds:['hands'],date:'2026-10-22',time:'09:00',duration:60,price:90,status:'agendado'}],transactions:[],settings:{start:'08:00',end:'18:00',lunch:'12:00',lunchDuration:60}};
  let selected=['hands'];
  const context=vm.createContext({db,$:element,uid:()=>`new-${++sequence}`,persist:()=>saved++,closeModal(){},renderAll(){},alert:message=>alerts.push(message),confirm:()=>true,modal:(title,body)=>{opened={title,body}},document:{querySelectorAll:()=>selected.map(value=>({value}))},dateToday:'2026-10-22',esc:value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),durationLabel:n=>n+' min',money:n=>'R$ '+n.toFixed(2),mins:time=>{const [h,m]=time.split(':').map(Number);return h*60+m},tstr:n=>`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`,readableDate:value=>value});
  vm.runInContext(source,context);
  // Keep rendering under test callable, while save actions only persist their data.
  context.renderAll=()=>{};
  const form=values=>{for(const [id,value] of Object.entries({apType:'service',apClient:'c1',apDate:'2026-10-22',apTime:'08:00',apStatus:'agendado',apTreatmentNotes:'',...values}))element(id).value=value};
  return {db,context,element,alerts,form,get opened(){return opened},get saved(){return saved},select:ids=>{selected=ids}};
}

test('day view exposes each free interval around bookings and protected lunch',()=>{
  const f=fixture();f.context.renderAgenda();
  const output=f.element('agendaItems').innerHTML;
  assert.match(output,/08:00–09:00/);
  assert.match(output,/10:00–12:00/);
  assert.match(output,/13:00–18:00/);
  assert.ok(output.indexOf('08:00–09:00')<output.indexOf('09:00 · Ana'));
  assert.ok(output.indexOf('10:00–12:00')<output.indexOf('Pausa para almoço'));
  const firstCard=output.slice(0,output.indexOf('09:00 · Ana'));
  assert.match(firstCard,/Duas mãos/);
  assert.equal(firstCard.includes('Sessão longa'),false,'a 2h service cannot be suggested in a 1h gap');
});

test('free intervals merge overlaps, ignore cancellations and stay inside working hours',()=>{
  const f=fixture();
  f.db.appointments.push(
    {id:'p1',type:'personal',title:'Academia',date:'2026-10-22',time:'07:30',duration:60,status:'agendado',price:0},
    {id:'p2',type:'personal',title:'Reunião',date:'2026-10-22',time:'08:15',duration:30,status:'agendado',price:0},
    {id:'cancel',date:'2026-10-22',time:'10:00',duration:120,status:'cancelado'},
    {id:'late',date:'2026-10-22',time:'17:00',duration:120,status:'agendado'}
  );
  assert.deepEqual(copy(f.context.freeBlocks('2026-10-22')),[{start:525,end:540},{start:600,end:720},{start:780,end:1020}]);
  f.db.appointments=[];
  assert.deepEqual(copy(f.context.freeBlocks('2026-10-22')),[{start:480,end:720},{start:780,end:1080}]);
  f.db.appointments=[{id:'full-am',date:'2026-10-22',time:'08:00',duration:240,status:'agendado'},{id:'full-pm',date:'2026-10-22',time:'13:00',duration:300,status:'agendado'}];
  assert.deepEqual(copy(f.context.freeBlocks('2026-10-22')),[]);
});

test('clicking a free card or suggestion opens the existing scheduling panel with its date and time',()=>{
  const f=fixture();f.context.renderAgenda();
  const output=f.element('agendaItems').innerHTML;
  const handler=output.match(/onclick="([^"]+)"/)[1];
  vm.runInContext(handler,f.context);
  assert.match(f.opened.body,/id="apDate"[^>]*value="2026-10-22"/);
  assert.match(f.opened.body,/id="apTime"[^>]*value="08:00"/);
  const suggestion=[...output.matchAll(/<button[^>]*onclick="([^"]+)"[^>]*>([\s\S]*?)<\/button>/g)].find(match=>match[2].includes('Duas mãos'));
  assert.ok(suggestion,'service suggestion is actionable');
  vm.runInContext(suggestion[1],f.context);
  assert.match(f.opened.body,/value="hands"\s+checked/);
});

test('personal commitments require no client or catalog, reserve time and never create revenue',()=>{
  const f=fixture();f.db.clients=[];f.db.services=[];
  f.context.openAppointment('',{type:'personal',time:'07:00'});
  assert.equal(f.alerts.length,0);
  assert.match(f.opened.body,/apPersonalTitle/);
  f.form({apType:'personal',apPersonalTitle:'Academia <manhã>',apPersonalDuration:'60',apTime:'07:00'});
  f.context.saveAppointment('');
  const personal=f.db.appointments.at(-1);
  assert.equal(personal.type,'personal');assert.equal(personal.title,'Academia <manhã>');
  assert.equal(personal.price,0);assert.equal(personal.clientId,null);assert.deepEqual(copy(personal.serviceIds),[]);
  assert.equal(f.db.transactions.length,0);assert.equal(f.saved,1);
  const row=f.context.appointmentRow(personal);
  assert.match(row,/Academia &lt;manhã&gt;/);assert.equal(row.includes('R$'),false);
  f.context.appointmentActions(personal.id);
  assert.equal(f.opened.body.includes('Registrar pagamento'),false);
  assert.equal(f.opened.body.includes('relato'),false);
  f.context.openIncome(personal.id);assert.match(f.alerts.at(-1),/pessoal/i);
  f.form({iAmount:'10',iName:'Academia',iDate:'2026-10-22',iMethod:'Pix'});
  f.context.saveIncome(personal.id);assert.equal(f.db.transactions.length,0);
  f.context.updateApStatus(personal.id,'concluido');assert.equal(personal.status,'concluido');
  assert.equal(f.db.transactions.length,0);
});

test('personal bookings block appointments, reject overlaps and become available after cancellation',()=>{
  const f=fixture();
  f.form({apType:'personal',apPersonalTitle:'Academia',apPersonalDuration:'60',apTime:'08:00'});
  f.context.saveAppointment('');const personal=f.db.appointments.at(-1);
  f.form({apTime:'08:30'});f.context.saveAppointment('');
  assert.equal(f.db.appointments.length,2);assert.match(f.alerts.at(-1),/Conflito/);
  f.form({apType:'personal',apPersonalTitle:'Outro',apPersonalDuration:'30',apTime:'09:30'});f.context.saveAppointment('');
  assert.equal(f.db.appointments.length,2);
  f.context.updateApStatus(personal.id,'cancelado');
  f.form();f.context.saveAppointment('');assert.equal(f.db.appointments.length,3);
  f.context.updateApStatus(personal.id,'agendado');assert.equal(personal.status,'cancelado');
});

test('invalid personal durations and empty titles do not modify the agenda',()=>{
  const f=fixture();
  for(const invalid of ['0','-5','NaN','Infinity','1500','5.5']){
    f.form({apType:'personal',apPersonalTitle:'Academia',apPersonalDuration:invalid});f.context.saveAppointment('');
    assert.equal(f.db.appointments.length,1,invalid);
  }
  f.form({apType:'personal',apPersonalTitle:'  ',apPersonalDuration:'60'});f.context.saveAppointment('');
  assert.equal(f.db.appointments.length,1);
  f.form({apType:'personal',apPersonalTitle:'Academia',apPersonalDuration:'60',apTime:'23:30'});f.context.saveAppointment('');
  assert.equal(f.db.appointments.length,1,'commitments must end on the same day');
});

test('day summary separates clients and personal commitments and suggestions exclude both',()=>{
  const f=fixture();
  f.form({apType:'personal',apPersonalTitle:'Academia',apPersonalDuration:'60',apTime:'10:00'});f.context.saveAppointment('');
  f.context.renderAgenda();
  assert.match(f.element('agendaSummary').innerHTML,/1 atendimento/);
  assert.match(f.element('agendaSummary').innerHTML,/1 pessoal/);
  assert.equal(f.element('agendaItems').innerHTML.includes('10:00–12:00'),false);
  assert.match(f.element('agendaItems').innerHTML,/11:00–12:00/);
  assert.match(f.element('agendaItems').innerHTML,/Academia/);
});

test('working hours remain editable with personal commitments outside work or during lunch',()=>{
  const f=fixture();
  f.db.appointments.push({id:'gym',type:'personal',title:'Academia',date:'2026-10-22',time:'07:00',duration:60,status:'agendado',price:0},{id:'personal-lunch',type:'personal',title:'Consulta',date:'2026-10-22',time:'12:15',duration:30,status:'agendado',price:0});
  for(const [id,value] of Object.entries({workStart:'08:00',workEnd:'17:00',lunchStart:'12:00',lunchDuration:'75'}))f.element(id).value=value;
  f.context.saveSettings();
  assert.deepEqual(copy(f.db.settings),{start:'08:00',end:'17:00',lunch:'12:00',lunchDuration:75});
  assert.equal(f.saved,1);
  f.element('workStart').value='09:30';f.context.saveSettings();
  assert.equal(f.db.settings.start,'08:00');assert.equal(f.saved,1);
  assert.match(f.alerts.at(-1),/conflito/);
});

test('API accepts personal commitments but rejects personal prices and linked income',async()=>{
  const api=await readFile(new URL('../api/index.js',import.meta.url),'utf8');
  const validate=vm.runInNewContext(api.match(/^function validateData.*$/m)[0]+';validateData');
  const f=fixture();
  const personal={id:'p1',type:'personal',title:'Academia',date:'2026-10-22',time:'07:00',duration:60,status:'agendado',price:0,clientId:null,serviceIds:[]};
  f.db.appointments.push(personal);assert.equal(validate(f.db),true);
  personal.price=10;assert.equal(validate(f.db),false);personal.price=0;
  personal.duration=0;assert.equal(validate(f.db),false);personal.duration=60;
  personal.title='';assert.equal(validate(f.db),false);personal.title='Academia';
  f.db.transactions.push({id:'t1',type:'income',description:'Inválido',amount:10,date:'2026-10-22',appointmentId:'p1'});
  assert.equal(validate(f.db),false);
});
