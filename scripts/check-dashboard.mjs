import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../dashboard-ui.js',import.meta.url),'utf8').catch(()=> '');
const core=await readFile(new URL('../finance-core.js',import.meta.url),'utf8');
const clone=value=>JSON.parse(JSON.stringify(value));
function fixture(){
 const elements=new Map(),calls=[],alerts=[];
 const element=id=>{if(!elements.has(id))elements.set(id,{value:'',textContent:'',innerHTML:'',disabled:false,classList:{add(){},remove(){},toggle(){}},querySelectorAll(){return []}});return elements.get(id)};
 element('dashboardMonth').value='2026-10';
 const data={settings:{start:'08:00',end:'18:00',lunch:'12:00',lunchDuration:60},services:[],clients:[],appointments:[],transactions:[]};
 const accounts=[{profile:'podo',username:'raquel',revision:2,data:clone(data)},{profile:'personal',username:'jefferson',revision:5,data:clone(data)}];
 const context=vm.createContext({console,crypto:globalThis.crypto,$:element,FinanceCore:null,unlocked:true,currentUsername:'raquel',profile:'podo',db:clone(data),revision:2,saveFailed:false,saveChain:Promise.resolve(),dateToday:'2026-10-22',uid:()=>crypto.randomUUID(),esc:value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),money:value=>'R$ '+Number(value).toFixed(2),modal(){},closeModal(){},renderAll(){},navigate:id=>calls.push({navigate:id}),alert:message=>alerts.push(message),document:{body:element('body'),querySelectorAll:()=>[...elements.values()]},api:async(action,payload)=>{calls.push({action,payload});if(action==='adminOverview')return{accounts:clone(accounts)};const target=accounts.find(a=>a.profile===payload.targetProfile);target.data={...target.data,...('finance'in payload?{finance:payload.finance}:{}),...('settings'in payload?{settings:payload.settings}:{})};target.revision++;return{data:clone(target.data),revision:target.revision}}});
 vm.runInContext(core,context);vm.runInContext(source,context);
 return{context,element,calls,alerts,accounts};
}

const restricted=fixture();
assert.equal(typeof restricted.context.openManagementDashboard,'function','Dashboard entry must exist');
await restricted.context.openManagementDashboard();
assert.equal(restricted.calls.some(call=>call.action==='adminOverview'),false);
assert.ok(restricted.alerts.length);

const admin=fixture();admin.context.profile='personal';admin.context.currentUsername='jefferson';
admin.context.FinanceCore.saveRecurring(admin.accounts[0].data,{description:'Internet futura',category:'Internet',fixed:true,expectedAmount:100,dueDay:10,startMonth:'2026-10',endMonth:null,active:true});
await admin.context.openManagementDashboard();
assert.ok(admin.calls.some(call=>call.action==='adminOverview'));
assert.match(admin.element('dashboardContent').innerHTML,/Raquel/);
assert.match(admin.element('dashboardContent').innerHTML,/Jefferson/);
admin.element('dashboardMonth').value='2026-11';admin.context.renderManagementDashboard();
assert.match(admin.element('dashboardContent').innerHTML,/Vencimento 10\/11\/2026/,'Future month shows generated recurring bills even if its owner has not opened it');
admin.element('dashboardMonth').value='2026-10';admin.context.renderManagementDashboard();
for(const [id,value]of Object.entries({'dash_podo_balance':'500','dash_podo_reason':'','dash_podo_income':'2000','dash_podo_mode':'percentage','dash_podo_reserve':'10','dash_podo_day':'15','dash_podo_start':'08:00','dash_podo_end':'18:00','dash_podo_lunch':'12:00','dash_podo_lunchDuration':'60'}))admin.element(id).value=value;
await admin.context.saveDashboardSettings('podo');
const save=admin.calls.find(call=>call.action==='adminSaveSettings');
assert.ok(save);assert.equal(save.payload.targetProfile,'podo');assert.equal(save.payload.revision,2);
assert.equal(save.payload.finance.openingBalance.amount,500);
assert.equal(save.payload.finance.monthlyPlans[0].reserveValue,10);
assert.equal('transactions'in save.payload,false);assert.equal('clients'in save.payload,false);
assert.equal(admin.context.profile,'personal','Saving another environment never switches the current user');
assert.equal(admin.context.db.finance,undefined,'Saving Raquel settings does not replace Jefferson data');
const count=admin.calls.filter(call=>call.action==='adminSaveSettings').length;
admin.element('dash_podo_balance').value='600';admin.element('dash_podo_reason').value='';
await admin.context.saveDashboardSettings('podo');
assert.equal(admin.calls.filter(call=>call.action==='adminSaveSettings').length,count,'Missing correction reason prevents saving');
admin.element('dash_podo_reason').value='Conferência com saldo bancário';
await admin.context.saveDashboardSettings('podo');
const last=admin.calls.filter(call=>call.action==='adminSaveSettings').at(-1);
assert.equal(last.payload.finance.adjustments[0].delta,100);
assert.equal(last.payload.finance.adjustments[0].reason,'Conferência com saldo bancário');
admin.context.clearManagementDashboard();
assert.equal(admin.element('dashboardContent').innerHTML,'');

const delayed=fixture();delayed.context.profile='personal';delayed.context.currentUsername='jefferson';
await delayed.context.openManagementDashboard();
let finishSave;const originalApi=delayed.context.api;
delayed.context.api=(action,payload)=>action==='adminSaveSettings'?new Promise(resolve=>{finishSave=async()=>resolve(await originalApi(action,payload))}):originalApi(action,payload);
const control=delayed.element('navigationControl');
const saving=delayed.context.dashboardSave('personal',{});
await new Promise(resolve=>setImmediate(resolve));
assert.equal(control.disabled,true,'Navigation and other controls are disabled during the admin request');
const loads=delayed.calls.filter(call=>call.action==='adminOverview').length;
await delayed.context.loadManagementDashboard();
assert.equal(delayed.calls.filter(call=>call.action==='adminOverview').length,loads,'Refresh cannot discard an in-flight saved revision');
await finishSave();await saving;
assert.equal(control.disabled,false);assert.equal(delayed.context.revision,6);

const autosave=fixture();autosave.context.profile='personal';autosave.context.currentUsername='jefferson';autosave.context.revision=5;
await autosave.context.openManagementDashboard();
let generated=false;
autosave.context.renderAll=()=>{if(generated)return;generated=true;autosave.context.saveChain=autosave.context.saveChain.then(()=>{autosave.accounts[1].revision++;autosave.context.revision=autosave.accounts[1].revision})};
await autosave.context.dashboardSave('personal',{});
await autosave.context.saveChain;
await autosave.context.dashboardSave('personal',{});
assert.equal(autosave.calls.filter(call=>call.action==='adminSaveSettings').at(-1).payload.revision,7,'A bill-generation autosave must advance the cached dashboard revision');
console.log('OK: painel restrito, duas visões, configuração de outro ambiente e motivo de correção obrigatório.');
