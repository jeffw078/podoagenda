import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createFinanceInsights} from '../src/shared/finance-insights.js';
import '../src/shared/finance-core.js';
const F=globalThis.FinanceCore,I=createFinanceInsights(F);
const data={transactions:[
 {id:'cash',type:'expense',description:'Compra no mercado',category:'Mercado',amount:100,date:'2026-11-01',method:'Dinheiro'},
 {id:'income',type:'income',description:'Receita',category:'Mercado',amount:3000,date:'2026-11-01'},
 {id:'custom',type:'expense',description:'<Nome & especial>',category:'Outros " &',amount:10,date:'2026-11-01',method:'pix'}
]};
F.ensureCreditCards(data,'2026-11');
F.recordCreditPurchase(data,{cardId:'nubank',description:'Supermercado no cart\u00e3o',category:'Mercado',purchaseDate:'2026-10-15',amount:200,items:[],installments:[{date:'2026-11-01',amount:100,installmentNumber:1,installmentCount:2},{date:'2026-12-01',amount:100,installmentNumber:2,installmentCount:2}]});
F.recordCreditPurchase(data,{cardId:'nubank',description:'Farm\u00e1cia',category:'Sa\u00fade',purchaseDate:'2026-10-16',amount:25,items:[],installments:[{date:'2026-11-01',amount:25,installmentNumber:1,installmentCount:1}]});
F.payBill(data,'recurring:card:nubank:2026-11',{amount:125,date:'2026-11-02',method:'pix'});
F.setMonthPlan(data,'2026-11',{expectedIncome:3000,reserveMode:'amount',reserveValue:20,reserveDueDay:10});
F.payBill(data,'reserve:2026-11',{amount:20,date:'2026-11-02',method:'pix'});
const bill=F.createBill(data,{dueDate:'2026-11-02',description:'Conta da casa',category:'Moradia',expectedAmount:50});
F.payBill(data,bill.id,{amount:50,date:'2026-11-02',method:'pix'});
const snapshot=structuredClone(data),overview=I.overview(data,'2026-11','2026-11-02');
assert.ok(Array.isArray(overview.categoryExpenses),'The chart must expose the expenses behind each category total');
const market=overview.categoryExpenses.filter(row=>row.category==='Mercado');
assert.equal(market.length,2);assert.equal(market.reduce((sum,row)=>sum+row.amount,0),200);
assert.equal(market.find(row=>row.source==='credit').amount,100,'Only the selected invoice installment is included');
assert.equal(market.find(row=>row.source==='credit').installmentNumber,1);
assert.equal(overview.categoryExpenses.length,5,'Income, invoice settlement and reserve payment must not be listed as consumption');
for(const category of overview.categories)assert.equal(overview.categoryExpenses.filter(row=>row.category===category.category).reduce((sum,row)=>sum+Math.round(row.amount*100),0),Math.round(category.amount*100),'Details sum to the same total as the chart');
assert.deepEqual(data,snapshot,'Opening chart details must not change financial records');
let opened;
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const context=vm.createContext({db:data,dateToday:'2026-11-02',FinanceCore:F,FinanceInsights:I,esc:escape,money:n=>Number(n).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}),modal:(title,html)=>{opened={title,html};}});
for(const file of ['finance-ui.js','finance-widgets.js'])vm.runInContext(fs.readFileSync(new URL('../src/client/'+file,import.meta.url),'utf8'),context);
const chart=context.financeIndicatorsHtml('2026-11');
assert.match(chart,/financeOpenCategory\(/,'Every category provides an action to inspect its expenses');
context.financeOpenCategory('2026-11','Mercado');
assert.match(opened.title,/Mercado/);assert.match(opened.html,/Compra no mercado/);assert.match(opened.html,/Supermercado no cart/);
assert.match(opened.html,/15\/10\/2026/,'Credit purchase date stays visible even when its invoice is in a different month');
assert.match(opened.html,/Parcela 1\/2/);assert.match(opened.html,/200,00/);assert.doesNotMatch(opened.html,/Farm/);
context.financeOpenCategory('2026-12','Mercado');
assert.doesNotMatch(opened.html,/Compra no mercado/,'Opening another month never shows unrelated cash expenses');
assert.match(opened.html,/Parcela 2\/2/);assert.match(opened.html,/100,00/);
context.financeOpenCategory('2026-11','Outros " &');
assert.match(opened.html,/&lt;Nome &amp; especial&gt;/);assert.doesNotMatch(opened.html,/<Nome/);
context.financeOpenCategory('2026-11','Sem gastos');assert.match(opened.html,/Nenhum gasto/);
assert.deepEqual(data,snapshot);
console.log('Category details passed: matching totals, selected installment/month, no double-counted invoice or reserve, escaped descriptions and read-only modal.');
