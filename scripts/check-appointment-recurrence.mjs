import assert from 'node:assert/strict';
import { test } from 'node:test';
let model;
test('recurrence model is available',async()=>{await assert.doesNotReject(async()=>{model=await import('../src/shared/appointment-recurrence.js')})});
const today='2026-11-03';
const record=(date=today,extra={})=>({type:'service',clientId:'c1',serviceIds:['s1'],date,time:'09:00',duration:60,price:80,status:'agendado',treatmentNotes:'',...extra});
const db=appointments=>({appointments:appointments||[],transactions:[],clients:[{id:'c1'}],services:[{id:'s1'}],settings:{start:'08:00',end:'18:00',lunch:'12:00',lunchDuration:60}});
const ids=()=>{let n=0;return()=>`new-${++n}`};
const weekly={frequency:'weekly',interval:1,endDate:'2026-11-24'};
const series=(date,extra={})=>({id:date,...record(date),recurrence:{id:'series-1',...weekly,occurrenceDate:date},...extra});
const save=(data,options={},makeId=ids())=>model.prepareAppointmentSave(data,{record:record(),repeat:weekly,scope:'one',today,...options},makeId);

test('monthly dates recover the original anchor after short months',()=>{
 assert.deepEqual(model.recurrenceDates('2027-01-31',{frequency:'monthly',interval:1,endDate:'2027-04-30'}),['2027-01-31','2027-02-28','2027-03-31','2027-04-30']);
 assert.deepEqual(model.recurrenceDates('2028-01-31',{frequency:'monthly',interval:1,endDate:'2028-03-31'}),['2028-01-31','2028-02-29','2028-03-31']);
});
test('daily and interval weeks include boundaries and weekends across DST',()=>{
 assert.deepEqual(model.recurrenceDates('2026-10-31',{frequency:'daily',interval:1,endDate:today}),['2026-10-31','2026-11-01','2026-11-02','2026-11-03']);
 assert.deepEqual(model.recurrenceDates(today,{frequency:'weekly',interval:2,endDate:'2026-12-01'}),[today,'2026-11-17','2026-12-01']);
 assert.deepEqual(model.recurrenceDates('0001-01-01',{frequency:'monthly',interval:12,endDate:'0002-01-01'}),['0001-01-01','0002-01-01']);
 assert.deepEqual(model.recurrenceDates('9999-12-31',{frequency:'daily',interval:1,endDate:'9999-12-31'}),['9999-12-31']);
});
test('invalid real dates, rules and more than 366 occurrences reject',()=>{
 for(const start of ['2026-02-29','2026-04-31','0000-01-01','10000-01-01','2026-1-01'])assert.throws(()=>model.recurrenceDates(start,weekly));
 for(const rule of [{...weekly,endDate:'2026-02-30'},{...weekly,endDate:'2026-11-02'},{...weekly,frequency:'yearly'},{...weekly,interval:0},{...weekly,interval:13},{...weekly,interval:1.5},{...weekly,interval:'1'}])assert.throws(()=>model.recurrenceDates(today,rule));
 assert.equal(model.recurrenceDates('2028-01-01',{frequency:'daily',interval:1,endDate:'2028-12-31'}).length,366);
 assert.throws(()=>model.recurrenceDates('2028-01-01',{frequency:'daily',interval:1,endDate:'2029-01-01'}),/366/);
});
test('new series creates independent normal records with linked metadata and unique ids',()=>{
 const data=db(),before=structuredClone(data),result=save(data);
 assert.equal(result.count,4);assert.equal(new Set(result.appointments.map(a=>a.id)).size,4);
 assert.deepEqual(result.appointments.map(a=>a.date),[today,'2026-11-10','2026-11-17','2026-11-24']);
 assert.equal(new Set(result.appointments.map(a=>a.recurrence.id)).size,1);
 assert.deepEqual(result.appointments.map(a=>a.recurrence.occurrenceDate),[today,'2026-11-10','2026-11-17','2026-11-24']);
 assert.deepEqual(data,before);result.appointments[0].serviceIds.push('x');assert.deepEqual(result.appointments[1].serviceIds,['s1']);
});
test('converting one scheduled appointment keeps its first id and rejects paid conversion',()=>{
 const data=db([{id:'single',...record()}]),result=save(data,{id:'single'});
 assert.equal(result.count,4);assert.equal(result.appointments.find(a=>a.date===today).id,'single');
 data.transactions.push({type:'income',appointmentId:'single'});assert.throws(()=>save(data,{id:'single'}));
});
test('single reschedule retains original occurrence identity and siblings',()=>{
 const data=db([series(today),series('2026-11-10')]),result=save(data,{id:today,record:record('2026-11-04'),repeat:null});
 assert.equal(result.count,1);assert.equal(result.appointments[0].date,'2026-11-04');assert.equal(result.appointments[0].recurrence.occurrenceDate,today);assert.deepEqual(result.appointments[1],data.appointments[1]);assert.equal(data.appointments[0].date,today);
});
test('future regeneration preserves earlier, completed, cancelled and paid exceptions',()=>{
 const data=db([series('2026-10-27'),series(today),series('2026-11-10',{status:'concluido',treatmentNotes:'clinical',completedAt:'old'}),series('2026-11-17',{status:'cancelado'}),series('2026-11-24')]);data.transactions.push({type:'income',appointmentId:'2026-11-24'});
 const result=save(data,{id:today,record:record(today,{time:'10:00'}),scope:'future'});assert.equal(result.count,1);assert.equal(result.appointments.length,5);
 for(const date of ['2026-10-27','2026-11-10','2026-11-17','2026-11-24'])assert.deepEqual(result.appointments.find(a=>a.id===date),data.appointments.find(a=>a.id===date));
 assert.equal(result.appointments.find(a=>a.id===today).time,'10:00');
});
test('future edit targets original dates after a single occurrence was moved',()=>{
 const data=db([series('2026-10-27'),series(today,{date:'2026-11-04'}),series('2026-11-10'),series('2026-11-17')]);
 const result=save(data,{id:today,record:record('2026-11-05'),repeat:{...weekly,endDate:'2026-11-19'},scope:'future'});
 assert.deepEqual(result.appointments.map(a=>a.date).sort(),['2026-10-27','2026-11-05','2026-11-12','2026-11-19']);assert.equal(result.count,3);
});
test('generated records reset clinical completion history and notes',()=>{
 const result=save(db(),{record:record(today,{treatmentNotes:'historical',completedAt:'old',notesUpdatedAt:'old',serviceSnapshot:[{}]})});
 for(const a of result.appointments){assert.equal(a.status,'agendado');assert.equal(a.treatmentNotes,'');assert.equal(a.completedAt,undefined);assert.equal(a.notesUpdatedAt,undefined);assert.equal(a.serviceSnapshot,undefined)}
});
test('new repeats reject personal, closed, past and invalid scope selections',()=>{
 for(const candidate of [record(today,{type:'personal',title:'x'}),record(today,{status:'concluido'}),record(today,{status:'cancelado'}),record('2026-11-02')])assert.throws(()=>save(db(),{record:candidate}));
 assert.throws(()=>save(db(),{scope:'all'}));
});
test('later personal conflict rejects all candidates and reports date/time',()=>{
 const data=db([{id:'personal',...record('2026-11-17',{type:'personal',title:'guest',time:'09:30'})}]),before=structuredClone(data);
 assert.throws(()=>save(data),e=>/2026-11-17/.test(e.message)&&/09:00/.test(e.message));assert.deepEqual(data,before);
 data.appointments[0].status='cancelado';assert.equal(save(data).count,4);
});
test('work hours, lunch, dates, positive integer duration and same day ending are enforced',()=>{
 for(const change of [{time:'07:59'},{time:'17:30'},{time:'11:30'},{time:'23:30'},{duration:0},{duration:1.5},{date:'2026-02-30'},{time:'24:00'}])assert.throws(()=>save(db(),{record:record(today,change)}));
 assert.equal(save(db(),{record:record(today,{time:'11:00'})}).count,4);
});
test('ordinary single past completed and personal editing preserves old semantics',()=>{
 const past=record('2026-01-01',{status:'concluido',completedAt:'old',treatmentNotes:'saved'}),data=db([{id:'old',...past}]);
 assert.equal(save(data,{id:'old',record:{...past,time:'10:00'},repeat:null}).appointments[0].completedAt,'old');
 assert.equal(save(db(),{record:record(today,{type:'personal',title:'walk',time:'07:00'}),repeat:null}).count,1);
});
test('series editing rejects closed or paid selected occurrences',()=>{
 for(const status of ['concluido','cancelado'])assert.throws(()=>save(db([series(today,{status})]),{id:today,scope:'future'}));
 const data=db([series(today)]);data.transactions.push({type:'income',appointmentId:today});assert.throws(()=>save(data,{id:today,repeat:null}));
});
test('one and following cancellation retains rows and protects earlier paid and closed records',()=>{
 const data=db([series('2026-10-27'),series(today),series('2026-11-10'),series('2026-11-17',{status:'concluido'}),series('2026-11-24')]);data.transactions.push({type:'income',appointmentId:'2026-11-24'});
 const one=model.prepareAppointmentCancellation(data,{id:today,scope:'one',today});assert.equal(one.count,1);assert.equal(one.appointments[1].status,'cancelado');assert.equal(one.appointments[2].status,'agendado');
 const future=model.prepareAppointmentCancellation(data,{id:today,scope:'future',today});assert.equal(future.count,2);assert.deepEqual(future.appointments.map(a=>a.status),['agendado','cancelado','cancelado','concluido','agendado']);assert.equal(data.appointments[1].status,'agendado');
});
test('id collisions and more than 25000 stored appointments reject',()=>{
 assert.throws(()=>save(db(),{},()=> 'same'));
 const data=db(Array.from({length:25000},(_,n)=>({id:`retained-${n}`,status:'cancelado'})));assert.throws(()=>save(data),/25000/);
});

test('a series occurrence cannot be moved into the past through a single edit',()=>{
 assert.throws(()=>save(db([series(today)]),{id:today,record:record('2026-11-02'),repeat:null}),/hoje|passad|histórico/i);
});
test('a zero-length lunch does not block an adjacent working interval',()=>{
 const data=db();data.settings.lunchDuration=0;
 assert.equal(save(data,{record:record(today,{time:'11:30'})}).count,4);
});
test('protected moved exceptions block their actual occupied interval during regeneration',()=>{
 const data=db([series(today),series('2026-11-10',{date:'2026-11-11',status:'concluido',treatmentNotes:'history'})]);
 assert.throws(()=>save(data,{id:today,record:record('2026-11-04'),scope:'future'}),/2026-11-11/);
 assert.equal(data.appointments[1].treatmentNotes,'history');
});

const monthlyRule={frequency:'monthly',interval:1,endDate:'2027-04-30'};
const monthlyFixture=(withAnchor=true)=>db(['2027-01-31','2027-02-28','2027-03-31','2027-04-30'].map(date=>({id:date,...record(date),recurrence:{id:'monthly-series',...monthlyRule,occurrenceDate:date,...(withAnchor?{anchorDate:'2027-01-31'}:{})}})));
test('future time-only edit in a short month preserves the original monthly anchor',()=>{
 const result=save(monthlyFixture(),{id:'2027-02-28',record:record('2027-02-28',{time:'10:00'}),repeat:monthlyRule,scope:'future'});
 assert.deepEqual(result.appointments.map(a=>a.date).sort(),['2027-01-31','2027-02-28','2027-03-31','2027-04-30']);
 assert.ok(result.appointments.every(a=>a.recurrence.anchorDate==='2027-01-31'));
});
test('extending after the last short-month occurrence retains the original day anchor',()=>{
 const result=save(monthlyFixture(),{id:'2027-04-30',record:record('2027-04-30',{time:'10:00'}),repeat:{...monthlyRule,endDate:'2027-07-31'},scope:'future'});
 assert.deepEqual(result.appointments.map(a=>a.date).sort(),['2027-01-31','2027-02-28','2027-03-31','2027-04-30','2027-05-31','2027-06-30','2027-07-31']);
});
test('legacy monthly metadata infers its anchor from original occurrence dates',()=>{
 const data=monthlyFixture(false);data.appointments[0].date='2027-01-30';
 const result=save(data,{id:'2027-02-28',record:record('2027-02-28'),repeat:monthlyRule,scope:'future'});
 assert.deepEqual(result.appointments.map(a=>a.date).sort(),['2027-01-30','2027-02-28','2027-03-31','2027-04-30']);
 assert.equal(result.appointments.find(a=>a.id==='2027-02-28').recurrence.anchorDate,'2027-01-31');
});
test('intentional date or interval change establishes a new anchor for its segment',()=>{
 const shifted=save(monthlyFixture(),{id:'2027-02-28',record:record('2027-02-26'),repeat:monthlyRule,scope:'future'});
 assert.deepEqual(shifted.appointments.map(a=>a.date).sort(),['2027-01-31','2027-02-26','2027-03-26','2027-04-26']);
 assert.equal(shifted.appointments.find(a=>a.id==='2027-02-28').recurrence.anchorDate,'2027-02-26');
 const changedInterval=save(monthlyFixture(),{id:'2027-02-28',record:record('2027-02-28'),repeat:{...monthlyRule,interval:2,endDate:'2027-06-30'},scope:'future'});
 assert.deepEqual(changedInterval.appointments.map(a=>a.date).sort(),['2027-01-31','2027-02-28','2027-04-28','2027-06-28']);
 assert.equal(changedInterval.appointments.find(a=>a.id==='2027-02-28').recurrence.anchorDate,'2027-02-28');
});
test('a later time edit preserves its new segment anchor instead of a prior segment',()=>{
 const first=save(monthlyFixture(),{id:'2027-02-28',record:record('2027-02-26'),repeat:monthlyRule,scope:'future'});
 const selected=first.appointments.find(a=>a.date==='2027-03-26');
 const result=save({...db(),appointments:first.appointments},{id:selected.id,record:record('2027-03-26',{time:'10:00'}),repeat:{...monthlyRule,endDate:'2027-05-31'},scope:'future'},(()=>{let n=0;return()=>`after-${++n}`})());
 assert.deepEqual(result.appointments.map(a=>a.date).sort(),['2027-01-31','2027-02-26','2027-03-26','2027-04-26','2027-05-26']);
 assert.equal(result.appointments.find(a=>a.id===selected.id).recurrence.anchorDate,'2027-02-26');
});
