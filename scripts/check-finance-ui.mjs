import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// A DOM boundary double keeps the financial model real. These checks catch
// missing model writes, duplicate payments, misleading amounts, and lost audit.
const nodes = new Map();
const node = id => {
  if (!nodes.has(id)) nodes.set(id, { value: '', innerHTML: '', textContent: '', checked: false, focus() {} });
  return nodes.get(id);
};
let saves = 0;
let modalHtml = '';
const alerts = [];
const context = vm.createContext({
  console, Date, Intl, Math, JSON, Number, String, Boolean, structuredClone,
  crypto: { randomUUID: (() => { let n = 0; return () => `test-${++n}`; })() },
  db: { transactions: [], services: [], clients: [], appointments: [], settings: {} },
  profile: 'personal', dateToday: '2026-10-22', $: node,
  esc: value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  money: value => `R$ ${Number(value || 0).toFixed(2)}`,
  uid: () => 'ui-id', expenseCategories: ['Moradia', 'Outros'],
  persist() { saves++; }, renderAll() {}, closeModal() {},
  modal(title, html) { modalHtml = html; },
  alert(message) { alerts.push(message); }, confirm: () => true,
  renderSpendingForm: () => '<div id="purchase-entry">Itens da compra</div>',
  financeReserveRecurringHtml: () => '',
  financeIndicatorsHtml: month => `<section id="finance-indicators-placeholder" data-month="${month}"></section>`,
  financeCardLimitsForm: month => `<section id="card-limits-placeholder" data-month="${month}"></section>`,
  showSpendingFields() { node('spendingMounted').checked = true; },
});
const uiPath = new URL('../src/client/finance-ui.js', import.meta.url);
if (fs.existsSync(uiPath)) vm.runInContext(fs.readFileSync(uiPath, 'utf8'), context);
assert.equal(typeof context.renderPersonalFinance, 'function', 'personal financial dashboard must be available');
vm.runInContext(fs.readFileSync(new URL('../src/shared/finance-core.js', import.meta.url), 'utf8'), context);
const core = context.FinanceCore;
core.ensure(context.db);
core.setCurrentBalance(context.db, 1000, '2026-10-22');
const bill = core.createBill(context.db, { month: '2026-10', dueDate: '2026-10-25', description: '<Aluguel>', category: 'Moradia', expectedAmount: 300 });
const unknown = core.createBill(context.db, { month: '2026-10', dueDate: '2026-10-26', description: 'Água', category: 'Moradia', expectedAmount: null });
node('personalMonth').value = '2026-10';
context.renderPersonalFinance();
assert.match(node('personalFinanceContent').innerHTML, /R\$ 1000\.00/, 'available balance uses the opening balance');
assert.match(node('personalFinanceContent').innerHTML, /&lt;Aluguel&gt;/, 'bill descriptions are escaped');
assert.match(node('personalFinanceContent').innerHTML, /[Ss]em previs|[Aa] definir/, 'unknown estimates remain visible');
assert.match(node('personalFinanceContent').innerHTML, /finance-indicators-placeholder/, 'shared monthly indicators are included');
assert.doesNotMatch(node('personalFinanceContent').innerHTML, /finance-quick-actions|Planejar mês/, 'quick action row and plan button are absent');
assert.doesNotMatch(node('personalFinanceContent').innerHTML, />\s*<Aluguel>/);
node('financeMonth').value='2026-10';
context.profile='podo';
context.renderPersonalFinance('studioFinanceContent','financeMonth');
assert.equal(node('studioFinanceContent').innerHTML,node('personalFinanceContent').innerHTML,'Raquel and Jefferson use exactly the same financial control');
node('financeMonth').value='2026-11';
context.renderPersonalFinance('studioFinanceContent','financeMonth');
assert.doesNotMatch(node('studioFinanceContent').innerHTML,/&lt;Aluguel&gt;/,'Raquel financial month is independent from the hidden personal month');
context.profile='personal';
context.openFinanceExpenses();
assert.ok(modalHtml.indexOf('Gastos diários') < modalHtml.indexOf('Contas do mês'), 'spending tab appears first');
assert.doesNotMatch(modalHtml, /Conta avulsa/, 'standalone bill entry is removed');
assert.match(modalHtml, /purchase-entry/);
assert.equal(node('spendingMounted').checked, true);

context.financeOpenPayment(bill.id);
assert.doesNotMatch(modalHtml, /option value="credit"/, 'Bill payment is a cash settlement; credit purchases must choose a card in Gastos');
node('financePayMethod').value = 'credit';
node('financePayAmount').value = '325.40';
node('financePayDate').value = '2026-10-22';
context.financeSavePayment(bill.id);
assert.equal(context.db.transactions.length,0,'A stale credit payment form cannot bypass invoice selection');
node('financePayAmount').value = '325.40';
node('financePayDate').value = '2026-10-22';
node('financePayMethod').value = 'debit';
context.financeSavePayment(bill.id);
assert.equal(bill.expectedAmount, 300, 'payment preserves the estimate');
assert.equal(bill.paidAmount, 325.4);
assert.equal(context.db.transactions.length, 1);
const afterPayment = saves;
context.financeSavePayment(bill.id);
assert.equal(context.db.transactions.length, 1, 'a repeated UI submission cannot duplicate a payment');
assert.equal(saves, afterPayment, 'failed mutation is not persisted');
assert.ok(alerts.length);

context.financeOpenBalance();
node('financeBalanceAmount').value = '800';
node('financeBalanceDate').value = '2026-10-22';
node('financeBalanceReason').value = '';
context.financeSaveBalance();
assert.equal(context.db.finance.adjustments.length, 0, 'correction requires a reason');
node('financeBalanceReason').value = 'Conferência do extrato';
context.financeSaveBalance();
assert.equal(context.db.finance.adjustments.length, 1);
assert.equal(core.currentBalance(context.db, '2026-10-22'), 800);
context.renderFinanceSettings();
assert.match(node('financeSettingsContent').innerHTML, /Conferência do extrato/);
assert.match(node('financeSettingsContent').innerHTML, /card-limits-placeholder/, 'monthly card limits appear in settings');
assert.doesNotMatch(node('financeSettingsContent').innerHTML, /deleteAdjustment|Excluir ajuste/);

context.financeOpenPayment(unknown.id);
assert.match(modalHtml, /[Ss]em previs|[Aa] definir/, 'unknown bill payment asks for an actual amount');
core.setMonthPlan(context.db, '2026-10', { expectedIncome: 5000, reserveMode: 'percentage', reserveValue: 10, reserveDueDay: 31 });
node('reserveMonth').value = '2026-10';
context.renderReservePage();
assert.doesNotMatch(node('reserveContent').innerHTML, /Planejar reserva mensal|financePlanIncome_reserve/, 'reserve planning remains in settings only');
assert.match(node('reserveContent').innerHTML, /Reservado no mês/, 'reserve page shows actual launched amount');
const reserveBill = context.db.finance.bills.find(item => item.source === 'reserve');
context.financeOpenPayment(reserveBill.id);
node('financePayAmount').value = '500';
node('financePayDate').value = '2026-10-22';
node('financePayMethod').value = 'debit';
context.financeSavePayment(reserveBill.id);
context.renderReservePage();
assert.match(node('reserveContent').innerHTML, /Histórico da reserva/);
assert.match(node('reserveContent').innerHTML, /R\$ 500\.00/, 'reserve page shows the amount actually paid');
node('personalMonth').value = '2026-11';
context.renderPersonalFinance();
assert.doesNotMatch(node('personalFinanceContent').innerHTML, /&lt;Aluguel&gt;/, 'changing the selected month changes the bills shown');
context.openFinanceExpenses('bills');
assert.match(modalHtml, /value="2026-11"/, 'opening bills follows the dashboard month');
node('financeBillsMonth').value = '2026-10';
context.financeChangeBillsMonth();
assert.match(modalHtml, /&lt;Aluguel&gt;/, 'month selection inside the bills modal is preserved');
context.openFinanceExpenses('bills');
assert.match(modalHtml, /value="2026-11"/, 'a later dashboard opening resets the modal to its selected month');
core.recordCreditPurchase(context.db,{cardId:'nubank',description:'Material',category:'Outros',purchaseDate:'2026-10-22',amount:60,items:[],installments:[{date:'2026-11-01',amount:60,installmentNumber:1,installmentCount:1}]});
const beforeCardEdit=structuredClone(context.db);
context.financeOpenRecurring('card:nubank');
assert.doesNotMatch(modalHtml,/financeRecurringAmount|financeRecurringType|Valor base adicional/,'Card settings no longer offer a manual amount');
for(const [id,value] of Object.entries({financeRecurringDescription:'Fatura Nubank',financeRecurringCategory:'Cartão de crédito',financeRecurringType:'variable',financeRecurringAmount:'10',financeRecurringDue:'25',financeRecurringStart:'2026-10',financeRecurringEnd:'',financeRecurringActive:'true'}))node(id).value=value;
context.financeSaveRecurring('card:nubank');
assert.equal(context.db.finance.recurringBills.find(rule=>rule.id==='card:nubank').cardId,'nubank');
assert.equal(context.db.finance.bills.find(row=>row.sourceId==='card:nubank'&&row.month==='2026-11').expectedAmount,60,'A due-date edit retains purchases without a manual amount');
assert.ok(core.validateFinanceChange(beforeCardEdit,context.db),'UI changes satisfy server validation');
assert.equal(typeof context.financeOpenCreditEdit,'undefined','Manual future-installment editor is removed');
console.log('Finance UI behavior checks passed.');
