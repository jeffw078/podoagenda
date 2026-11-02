import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import '../src/shared/finance-core.js';
import {createFinanceInsights} from '../src/shared/finance-insights.js';
const F=globalThis.FinanceCore,I=createFinanceInsights(F);
const data={transactions:[]};
F.setMonthPlan(data,'2026-11',{expectedIncome:5000,reserveMode:'amount',reserveValue:20,reserveDueDay:10});
F.ensureCreditCards(data,'2026-11');
for(const [cardId,amount] of [['nubank',450.25],['mercado_pago',50.75]])F.recordCreditPurchase(data,{cardId,description:'Future bill',category:'Outros',amount,purchaseDate:'2026-10-22',items:[],installments:[{date:'2026-12-01',amount,installmentNumber:1,installmentCount:1}]});
F.saveRecurring(data,{description:'Living',category:'Moradia',expectedAmount:1000,fixed:true,dueDay:10,startMonth:'2026-11',endMonth:null,active:true});
const snapshot=structuredClone(data);
const overview=I.overview(data,'2026-12','2026-11-02');
assert.equal(overview.forecast.outflows,1501,'December forecast includes future card bills and recurring accounts even if the dashboard has not synced that month');
assert.deepEqual(data,snapshot,'Forecast must not persist generated bills');
assert.equal(overview.forecast.income,5000,'Future income can use the latest earlier plan as an explicitly identified estimate');
assert.equal(overview.forecast.incomePlanMonth,'2026-11');
assert.equal(overview.forecast.incomeEstimated,true);
assert.equal(overview.forecast.gap,3499);
F.setMonthPlan(data,'2026-12',{expectedIncome:0,reserveMode:'amount',reserveValue:0,reserveDueDay:10});
assert.equal(I.overview(data,'2026-12','2026-11-02').forecast.income,0,'An explicit zero income overrides an older estimate');
assert.equal(I.overview(data,'2026-12','2026-11-02').forecast.incomeEstimated,false);
assert.equal(I.overview(data,'2026-10','2026-11-02').forecast.income,0,'A future plan never fills a past month');
const actual={transactions:[
 {id:'received-1',type:'income',amount:1200.15,date:'2026-11-01'},
 {id:'received-2',type:'income',amount:100.25,date:'2026-11-02'},
 {id:'other-month',type:'income',amount:900,date:'2026-10-01'},
 {id:'expense',type:'expense',amount:50,date:'2026-11-02'}
]};
F.setMonthPlan(actual,'2026-11',{expectedIncome:5000,reserveMode:'amount',reserveValue:0,reserveDueDay:10});
const actualSnapshot=structuredClone(actual);
const actualForecast=I.overview(actual,'2026-11','2026-11-02').forecast;
assert.equal(actualForecast.income,1300.40,'Recorded income replaces a larger plan and includes every receipt exactly once');
assert.equal(actualForecast.incomeRecorded,true);
assert.equal(actualForecast.plannedIncome,5000,'The original plan remains available separately from actual receipts');
assert.equal(actualForecast.gap,1250.40);
assert.equal(actualForecast.incomeEstimated,false);
assert.deepEqual(actual,actualSnapshot);
const futureActual=structuredClone(actual);
futureActual.transactions.push({id:'future-receipt',type:'income',amount:80,date:'2026-12-01'});
const futureForecast=I.overview(futureActual,'2026-12','2026-11-02').forecast;
assert.equal(futureForecast.income,80,'A recorded receipt replaces the inherited estimate too');
assert.equal(futureForecast.incomeRecorded,true);assert.equal(futureForecast.incomeEstimated,false);
const nodes=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',innerHTML:''});return nodes.get(id);};
node('personalMonth').value='2026-12';
const ui=vm.createContext({db:structuredClone(snapshot),dateToday:'2026-11-02',FinanceCore:F,FinanceInsights:I,$:node,persist(){},money:n=>'R$ '+Number(n).toFixed(2),esc:s=>String(s??'').replaceAll('<','&lt;').replaceAll('>','&gt;')});
for(const file of ['finance-ui.js','finance-widgets.js'])vm.runInContext(fs.readFileSync(new URL('../src/client/'+file,import.meta.url),'utf8'),ui);
ui.renderPersonalFinance();
const rendered=node('personalFinanceContent').innerHTML;
assert.match(rendered,/Gastos já previstos/,'The main financial summary shows committed spending for the selected future month');
assert.match(rendered,/R\$ 1501\.00/);assert.match(rendered,/R\$ 3499\.00/);
assert.match(rendered,/Estimativa baseada.*novembro de 2026/,'The source of an estimated income is shown to the user');
ui.db=structuredClone(actual);node('personalMonth').value='2026-11';ui.renderPersonalFinance();
const actualRendered=node('personalFinanceContent').innerHTML;
assert.match(actualRendered,/Entradas reais/,'Actual income is identified on the summary and comparison card');
assert.match(actualRendered,/R\$ 1300\.40/);assert.match(actualRendered,/R\$ 1250\.40/);
assert.match(actualRendered,/Renda mensal prevista<\/dt><dd>R\$ 5000\.00/,'The plan is not relabeled with the amount already received');
const actualCard=ui.financeIndicatorsHtml('2026-11');
assert.match(actualCard,/Entradas reais/);assert.doesNotMatch(actualCard,/Entradas previstas/);
const app=fs.readFileSync(new URL('../src/client/app.js',import.meta.url),'utf8');
const initializer=app.slice(app.indexOf('function initializeViewDates()'),app.indexOf('function requireClinic()'));
for(const [today,month] of [['2026-11-02','2026-12'],['2026-12-31','2027-01'],['2027-01-31','2027-02']]){
 const nodes=Object.fromEntries(['agendaDate','personalMonth','financeMonth','reserveMonth','dashboardMonth'].map(id=>[id,{value:''}]));
 vm.runInNewContext(initializer+'\ninitializeViewDates();',{dateToday:today,pad:n=>String(n).padStart(2,'0'),$:id=>nodes[id]});
 assert.equal(nodes.personalMonth.value,month);assert.equal(nodes.financeMonth.value,month);assert.equal(nodes.reserveMonth.value,today.slice(0,7));
}
console.log('Forecast checks passed: upcoming month, recurring bills without prior render, income estimate, explicit zero and year rollover.');
