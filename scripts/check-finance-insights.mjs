import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createFinanceInsights, validateCardLimits } from '../src/shared/finance-insights.js';

const context = vm.createContext({ console, Date, Intl, Math, JSON, Number, String, Boolean, structuredClone, BigInt,
  crypto: { randomUUID: () => 'insight-test-id' } });
vm.runInContext(fs.readFileSync(new URL('../src/shared/finance-core.js', import.meta.url), 'utf8'), context);
const Core = context.FinanceCore, Insights = createFinanceInsights(Core);
const data = { transactions: [], finance: { version: 1, openingBalance: null, adjustments: [], monthlyPlans: [], recurringBills: [], bills: [], creditPurchases: [] } };
Core.setMonthPlan(data, '2026-10', { expectedIncome: 1000, reserveMode: 'percentage', reserveValue: 10, reserveDueDay: 25 });
data.transactions.push(
  { id: 'i1', type: 'income', amount: 1100, date: '2026-10-05', category: 'Atendimento' },
  { id: 'e1', type: 'expense', amount: 100, date: '2026-10-08', category: 'Mercado' },
  { id: 'e2', type: 'expense', amount: 20, date: '2026-10-09', category: 'Mercado' },
  { id: 'reserve1', type: 'expense', amount: 50, date: '2026-10-12', category: 'Reserva', financeKind: 'reserve' }
);
Core.ensureCreditCards(data, '2026-10');
data.finance.creditPurchases.push({ id: 'p1', cardId: 'nubank', category: 'FarmÃ¡cia', installments: [
  { date: '2026-10-01', amount: 30 }, { date: '2026-11-01', amount: 30 }
] }, { id: 'p2', cardId: 'nubank', category: 'FarmÃ¡cia', installments: [{ date: '2026-10-01', amount: 5 }] });
Core.syncMonth(data, '2026-10');
Core.syncMonth(data, '2026-11');
const insight = Insights.overview(data, '2026-10', '2026-10-22');
assert.equal(insight.forecast.income, 1100, 'actual income above plan is used without adding it twice');
assert.equal(insight.forecast.outflows, 305, 'known card and reserve obligations are included once');
assert.equal(insight.forecast.gap, 795);
assert.equal(insight.reserve.saved, 50);
assert.equal(insight.reserve.target, 100);
assert.equal(insight.reserve.difference, -50);
assert.deepEqual(insight.categories, [{ category: 'Mercado', amount: 120 }, { category: 'FarmÃ¡cia', amount: 35 }]);

const paid = structuredClone(data);
Core.payBill(paid, 'recurring:card:nubank:2026-10', { amount: 35, date: '2026-10-20', method: 'Pix' });
const paidOverview = Insights.overview(paid, '2026-10', '2026-10-22');
assert.equal(paidOverview.forecast.outflows, 305, 'card invoice payment replaces its open obligation');

assert.equal(validateCardLimits([]), true);
assert.equal(validateCardLimits([{ month: '2026-10', cardId: 'nubank', amount: 100 }]), true);
assert.equal(validateCardLimits([{ month: '2026-10', cardId: 'nubank', amount: 100 }, { month: '2026-10', cardId: 'nubank', amount: 200 }]), false);
assert.equal(validateCardLimits([{ month: '2026-13', cardId: 'nubank', amount: 100 }]), false);
assert.equal(validateCardLimits([{ month: '2026-10', cardId: 'amex', amount: 100 }]), false);
const limited = structuredClone(data);
Insights.setCardLimit(limited, '2026-10', 'nubank', 20.005);
assert.equal(limited.finance.cardLimits[0].amount, 20.01, 'limits round using integer cents');
assert.deepEqual(Insights.cardWarnings(limited), [{ month: '2026-10', cardId: 'nubank', limit: 20.01, committed: 35, projected: 35, excess: 14.99 }]);
assert.equal(Insights.cardWarnings(limited, { cardId: 'nubank', installments: [{ date: '2026-10-01', amount: 1 }, { date: '2026-10-01', amount: 2 }] })[0].projected, 38);
limited.finance.recurringBills.find(row => row.cardId === 'nubank').expectedAmount = 10;
limited.finance.cardLimits[0].amount = 40;
assert.equal(Insights.cardWarnings(limited)[0].committed, 45, 'recurring base and multiple purchases sum as cents');

const legacy = { transactions: [{ type: 'income', amount: 25, date: '2026-10-02' }] };
assert.equal(Insights.overview(legacy, '2026-10', '2026-10-22').forecast.income, 25);
assert.equal(legacy.finance, undefined, 'overview leaves legacy documents untouched');
const crossing={transactions:[]};
const oldBill=Core.createBill(crossing,{dueDate:'2026-09-20',description:'Conta atrasada',category:'Moradia',expectedAmount:50});
Core.payBill(crossing,oldBill.id,{amount:55,date:'2026-10-10',method:'pix'});
assert.equal(Insights.overview(crossing,'2026-10','2026-10-22').forecast.outflows,55,'Late bill payment belongs to the cash month, regardless of due month');
assert.deepEqual(Insights.overview(crossing,'2026-10','2026-10-22').categories,[{category:'Moradia',amount:55}]);
assert.equal(Insights.overview(crossing,'2026-09','2026-10-22').forecast.outflows,0,'Paid bill is not counted again by due month');
crossing.transactions.push({id:'future-income',type:'income',date:'2026-10-30',amount:80});
assert.equal(Insights.overview(crossing,'2026-10','2026-10-22').forecast.income,80,'Future dated entries participate in forecast');
console.log('Finance insights checks passed.');



