import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

assert.ok(existsSync(new URL('../finance-core.js', import.meta.url)), 'finance-core.js implements the finance contract');
await import('../finance-core.js');
const F = globalThis.FinanceCore;
const fresh = () => ({ transactions: [] });
const billInput = (extra = {}) => ({ description: 'Internet', category: 'Casa', dueDate: '2026-10-20', expectedAmount: 100, ...extra });
const recurringInput = (extra = {}) => ({ description: 'Aluguel', category: 'Casa', fixed: true, expectedAmount: 1000, dueDay: 31, startMonth: '2026-01', endMonth: null, active: true, ...extra });

// Losing legacy rows during initialization would erase installment history.
{
  const data = { transactions: [{ id: 'old', type: 'expense', amount: 33.34, date: '2026-10-01', installmentNumber: 1, installmentCount: 3 }] };
  const before = structuredClone(data.transactions);
  assert.equal(F.validateFinance(data), true);
  const finance = F.ensure(data);
  assert.equal(finance.version, 1);
  assert.deepEqual(data.transactions, before);
  assert.equal(F.ensure(data), finance);
  assert.equal(F.monthlySummary(data, '2026-10', '2026-10-22').spending, 33.34);
}

// Regeneration must clamp due dates and keep one mutable pending bill per rule/month.
{
  const data = fresh();
  const rule = F.saveRecurring(data, recurringInput());
  assert.equal(F.syncMonth(data, '2026-02')[0].dueDate, '2026-02-28');
  assert.equal(F.syncMonth(data, '2028-02')[0].dueDate, '2028-02-29');
  F.syncMonth(data, '2026-02');
  assert.equal(data.finance.bills.filter(b => b.month === '2026-02').length, 1);
  F.saveRecurring(data, { ...rule, expectedAmount: 1200, dueDay: 15 });
  assert.equal(F.syncMonth(data, '2026-02')[0].expectedAmount, 1200);
  assert.equal(F.syncMonth(data, '2026-02')[0].dueDate, '2026-02-15');
  const paid = F.payBill(data, data.finance.bills[0].id, { amount: 1180, date: '2026-02-15', method: 'Pix' });
  const snapshot = structuredClone(paid);
  F.saveRecurring(data, { ...rule, expectedAmount: 2000 });
  F.syncMonth(data, '2026-02');
  assert.deepEqual(paid, snapshot);
  assert.throws(() => F.payBill(data, paid.id, { amount: 1180, date: '2026-02-15', method: 'Pix' }));
  assert.equal(data.transactions.length, 1);
  assert.equal(paid.expectedAmount, 1200);
  assert.equal(paid.paidAmount, 1180);
  assert.equal(data.transactions[0].billId, paid.id);
  assert.equal(data.transactions[0].financeKind, 'bill');
  assert.equal(F.validateFinance(data), true);
  const rewrittenPaid = structuredClone(data);
  rewrittenPaid.finance.bills[0].expectedAmount = 10;
  assert.equal(F.validateFinanceChange(data, rewrittenPaid), false, 'paid bill history is immutable');
  const orphan = structuredClone(data);
  orphan.transactions = [];
  assert.equal(F.validateFinance(orphan), false, 'paid bill requires its original transaction');
  const stripped = structuredClone(data);
  delete stripped.finance;
  assert.equal(F.validateFinanceChange(data, stripped), false, 'paid finance history cannot be stripped');
}

// Unknown variable estimates must stay unknown and cancelled rules must not regenerate.
{
  const data = fresh();
  F.saveRecurring(data, recurringInput({ fixed: false, expectedAmount: null }));
  const [bill] = F.syncMonth(data, '2026-10');
  const summary = F.monthlySummary(data, '2026-10', '2026-10-22');
  assert.equal(summary.pending, 0);
  assert.equal(summary.pendingUnknown, 1);
  F.cancelBill(data, bill.id);
  const cancelled = structuredClone(bill);
  F.syncMonth(data, '2026-10');
  assert.deepEqual(bill, cancelled);
  assert.equal(F.monthlySummary(data, '2026-10', '2026-10-22').pendingUnknown, 0);
  const rewrittenCancelled = structuredClone(data);
  rewrittenCancelled.finance.bills[0].expectedAmount = 100;
  assert.equal(F.validateFinanceChange(data, rewrittenCancelled), false, 'cancelled recurring bills are immutable');
}

// Percentage reserve derives from planned income, never recursively from its last result.
{
  const data = fresh();
  F.setMonthPlan(data, '2026-10', { expectedIncome: 3333.33, reserveMode: 'percentage', reserveValue: 10, reserveDueDay: 31 });
  F.syncMonth(data, '2026-10');
  assert.equal(data.finance.bills[0].expectedAmount, 333.33);
  F.setMonthPlan(data, '2026-10', { expectedIncome: 4000, reserveMode: 'percentage', reserveValue: 10, reserveDueDay: 31 });
  assert.equal(data.finance.bills[0].expectedAmount, 400);
  F.setMonthPlan(data, '2026-10', { expectedIncome: 4000, reserveMode: 'amount', reserveValue: 0, reserveDueDay: 31 });
  assert.equal(F.monthlySummary(data, '2026-10', '2026-10-22').pending, 0);
  F.setMonthPlan(data, '2026-10', { expectedIncome: 4000, reserveMode: 'amount', reserveValue: 400, reserveDueDay: 31 });
  const reserve = data.finance.bills.find(b => b.status === 'pending');
  F.payBill(data, reserve.id, { amount: 400, date: '2026-10-20', method: 'Pix' });
  F.setMonthPlan(data, '2026-10', { expectedIncome: 4000, reserveMode: 'amount', reserveValue: 0, reserveDueDay: 31 });
  assert.equal(reserve.status, 'paid');
  const summary = F.monthlySummary(data, '2026-10', '2026-10-22');
  assert.equal(summary.reserved, 400);
  assert.equal(summary.spending, 0);
  assert.equal(summary.billsPaid, 0);
  assert.equal(summary.balance, -400);
}

// Opening balance records already counted transactions; future installments count when due.
{
  const data = { transactions: [
    { id: 'income', type: 'income', amount: 200, date: '2026-10-01' },
    { id: 'part1', type: 'expense', amount: 33.34, date: '2026-10-01', installmentCount: 3 },
    { id: 'part2', type: 'expense', amount: 33.33, date: '2026-11-01', installmentCount: 3 }
  ] };
  F.setCurrentBalance(data, 1000, '2026-10-10');
  assert.equal(F.currentBalance(data, '2026-10-22'), 1000);
  assert.equal(F.currentBalance(data, '2026-11-01'), 966.67);
  const bill = F.createBill(data, billInput({ expectedAmount: 10.005 }));
  assert.equal(bill.expectedAmount, 10.01);
  F.payBill(data, bill.id, { amount: 10.005, date: '2026-10-20', method: 'cash' });
  assert.equal(F.currentBalance(data, '2026-10-22'), 989.99);
  const initial = structuredClone(data);
  assert.throws(() => F.setCurrentBalance(data, 900, '2026-10-22'));
  F.setCurrentBalance(data, 900, '2026-10-22', 'Conferência do dinheiro');
  assert.equal(F.currentBalance(data, '2026-10-22'), 900);
  assert.equal(data.finance.adjustments[0].delta, -89.99);
  assert.equal(F.validateFinanceChange(initial, data), true);
  const edited = structuredClone(data);
  edited.finance.openingBalance.amount = 5;
  assert.equal(F.validateFinanceChange(data, edited), false);
  const removed = structuredClone(data);
  removed.finance.adjustments = [];
  assert.equal(F.validateFinanceChange(data, removed), false);
  const changed = structuredClone(data);
  changed.finance.adjustments[0].reason = 'Changed';
  assert.equal(F.validateFinanceChange(data, changed), false);
}

// Reporting separates consumption, paid bills and reserves and excludes future transactions.
{
  const data = { transactions: [
    { id: 'inc', type: 'income', amount: 1000.10, date: '2026-10-01' },
    { id: 'food', type: 'expense', amount: 0.10, date: '2026-10-02' },
    { id: 'food2', type: 'expense', amount: 0.20, date: '2026-10-03' },
    { id: 'future', type: 'expense', amount: 300, date: '2026-10-30' }
  ] };
  const paid = F.createBill(data, billInput());
  F.payBill(data, paid.id, { amount: 99.80, date: '2026-10-20', method: 'Pix' });
  F.createBill(data, billInput({ expectedAmount: 100.10 }));
  assert.deepEqual(F.monthlySummary(data, '2026-10', '2026-10-22'), {
    income: 1000.10, spending: 0.30, billsPaid: 99.80, reserved: 0,
    pending: 100.10, pendingUnknown: 0, reserveExpected: 0, balance: 900, freeAfterBills: 799.90
  });
}

// Reject invalid data before mutation; validators must reject nonfinite and impossible dates.
{
  const data = fresh();
  for (const amount of [NaN, Infinity, -1, '10', undefined]) assert.throws(() => F.createBill(data, billInput({ expectedAmount: amount })));
  for (const date of ['2026-02-29', '2026-13-01', '2026-10-32', '2026-1-01']) assert.throws(() => F.createBill(data, billInput({ dueDate: date })));
  assert.throws(() => F.syncMonth(data, '2026-13'));
  assert.throws(() => F.saveRecurring(data, recurringInput({ fixed: true, expectedAmount: null })));
  assert.throws(() => F.setMonthPlan(data, '2026-10', { expectedIncome: 1000, reserveMode: 'percentage', reserveValue: 101, reserveDueDay: 10 }));
  const valid = fresh();
  const bill = F.createBill(valid, billInput());
  assert.throws(() => F.payBill(valid, bill.id, { amount: 0, date: '2026-10-20', method: 'Pix' }));
  assert.equal(valid.transactions.length, 0);
  assert.equal(bill.status, 'pending');
  const malformed = structuredClone(valid);
  malformed.finance.bills[0].expectedAmount = NaN;
  assert.equal(F.validateFinance(malformed), false);
  assert.equal(F.validateFinance({ finance: null }), false);
  assert.equal(F.validateFinance({ finance: {} }), false);
  const unlinked = structuredClone(valid);
  unlinked.transactions.push({ id: 'forged', type: 'expense', amount: 100, date: '2026-10-20', billId: bill.id, financeKind: 'bill' });
  assert.equal(F.validateFinance(unlinked), false, 'pending bills cannot carry payment transactions');
}

// Decimal half-cent amounts must round predictably despite binary floating point.
{
  const data = fresh();
  assert.equal(F.createBill(data, billInput({ expectedAmount: 10.075 })).expectedAmount, 10.08);
  F.setCurrentBalance(data, -10.075, '2026-10-22');
  assert.equal(F.currentBalance(data, '2026-10-22'), -10.08);
  assert.equal(F.createBill(data, billInput({ expectedAmount: 1e-7 })).expectedAmount, 0);
  F.setMonthPlan(data, '2026-10', { expectedIncome: 0.35, reserveMode: 'percentage', reserveValue: 90, reserveDueDay: 10 });
  assert.equal(data.finance.bills.find(row => row.source === 'reserve').expectedAmount, 0.32);
}

// A new opening baseline must match the actual ledger, including same-save additions.
{
  const previous = { transactions: [{ id: 'legacy-income', type: 'income', amount: 200, date: '2026-10-01' }] };
  const next = structuredClone(previous);
  next.transactions.push({ id: 'same-save-expense', type: 'expense', amount: 25, date: '2026-10-20' });
  F.setCurrentBalance(next, 1000, '2026-10-22');
  assert.equal(next.finance.openingBalance.baseline, 175);
  assert.equal(F.validateFinanceChange(previous, next), true);
  const forged = structuredClone(next);
  forged.finance.openingBalance.baseline = 900;
  assert.equal(F.validateFinanceChange(previous, forged), false, 'new baseline must equal the saved ledger');
  const initialized = structuredClone(previous);
  F.ensure(initialized);
  assert.equal(F.validateFinanceChange(initialized, forged), false, 'initialized documents also require a real baseline');
}

// Newly appended correction snapshots must describe ledger balances, not just add correctly.
{
  const previous = fresh();
  F.setCurrentBalance(previous, 100, '2026-10-22');
  const forged = structuredClone(previous);
  forged.finance.adjustments.push({ id: 'forged-adjustment', date: '2026-10-22', delta: 900, before: 0, after: 900, reason: 'Conferência', createdAt: '2026-10-22T12:00:00Z' });
  assert.equal(F.validateFinanceChange(previous, forged), false, 'arithmetic alone does not establish a real before balance');
  const next = structuredClone(previous);
  next.transactions.push({ id: 'same-save-income', type: 'income', amount: 50, date: '2026-10-22' });
  F.setCurrentBalance(next, 120, '2026-10-22', 'Primeira conferência');
  F.setCurrentBalance(next, 110, '2026-10-22', 'Segunda conferência');
  assert.equal(next.finance.adjustments[0].before, 150);
  assert.equal(next.finance.adjustments[1].before, 120);
  assert.equal(F.validateFinanceChange(previous, next), true, 'ordered additions include only earlier adjustment effects');
  const laterForged = structuredClone(next);
  Object.assign(laterForged.finance.adjustments[1], { before: 0, after: -10, delta: -10 });
  assert.equal(F.validateFinanceChange(previous, laterForged), false);
  const historical = structuredClone(next);
  historical.transactions[0].amount = 60;
  F.setCurrentBalance(historical, 90, '2026-10-23', 'Conferência após correção do lançamento');
  assert.equal(historical.finance.adjustments[2].before, 120);
  assert.equal(F.validateFinanceChange(next, historical), true, 'existing audit snapshots remain immutable after historical ledger changes');
}

// Canonical generated identities keep imported records from duplicating on synchronization.
{
  const data = fresh();
  F.saveRecurring(data, recurringInput());
  const [bill] = F.syncMonth(data, '2026-10');
  F.payBill(data, bill.id, { amount: 1000, date: '2026-10-20', method: 'Pix' });
  const forged = structuredClone(data);
  forged.finance.bills[0].id = 'noncanonical';
  forged.transactions[0].billId = 'noncanonical';
  assert.equal(F.validateFinance(forged), false, 'recurring identity must match source and month');
  F.setMonthPlan(data, '2026-10', { expectedIncome: 1000, reserveMode: 'amount', reserveValue: 100, reserveDueDay: 10 });
  const wrongReserve = structuredClone(data);
  wrongReserve.finance.bills.find(row => row.source === 'reserve').sourceId = '2026-11';
  assert.equal(F.validateFinance(wrongReserve), false, 'reserve source month must match its bill month');
  const wrongReserveId = structuredClone(data);
  wrongReserveId.finance.bills.find(row => row.source === 'reserve').id = 'reserve:other';
  assert.equal(F.validateFinance(wrongReserveId), false, 'reserve identity must match its bill month');
}

// A future recorded payment remains a financial commitment until its effective date.
{
  const data = fresh();
  F.setCurrentBalance(data, 1000, '2026-10-22');
  const bill = F.createBill(data, billInput({ expectedAmount: 600 }));
  F.payBill(data, bill.id, { amount: 500, date: '2026-10-30', method: 'Pix' });
  const before = F.monthlySummary(data, '2026-10', '2026-10-22');
  assert.equal(before.pending, 500, 'actual recorded amount replaces estimate for a future payment');
  assert.equal(before.pendingUnknown, 0);
  assert.equal(before.balance, 1000);
  assert.equal(before.freeAfterBills, 500);
  const effective = F.monthlySummary(data, '2026-10', '2026-10-30');
  assert.equal(effective.pending, 0);
  assert.equal(effective.balance, 500);
  assert.equal(effective.freeAfterBills, 500);
}

// Seeded card rules preserve edits and stay isolated from legacy transactions/profiles.
{
  const raquel = fresh(), jefferson = fresh();
  assert.equal(typeof F.ensureCreditCards, 'function', 'core must expose card initialization');
  F.ensureCreditCards(raquel, '2026-10');
  assert.equal(raquel.finance.creditPurchases.length, 0);
  assert.deepEqual(raquel.finance.recurringBills.map(row => [row.id, row.cardId, row.expectedAmount, row.startMonth]), [
    ['card:nubank', 'nubank', 0, '2026-10'], ['card:mercado_pago', 'mercado_pago', 0, '2026-10']
  ]);
  const rule = raquel.finance.recurringBills[0];
  F.saveRecurring(raquel, { ...rule, expectedAmount: 12.34, dueDay: 31 });
  F.ensureCreditCards(raquel, '2027-01');
  assert.equal(raquel.finance.recurringBills.length, 2);
  assert.equal(rule.expectedAmount, 12.34);
  assert.equal(rule.dueDay, 31);
  assert.equal(rule.startMonth, '2026-10');
  assert.equal(F.syncMonth(raquel, '2026-10').length, 2, 'zero estimates still show card invoices');
  assert.equal(jefferson.finance, undefined);
}

const purchaseInput = (extra = {}) => ({ cardId: 'nubank', description: 'Compra', category: 'Mercado', purchaseDate: '2026-12-20', amount: 100, items: [{ name: 'Produto', qty: 1, unit: 100 }], installments: [
  { date: '2026-12-01', amount: 33.34, installmentNumber: 1, installmentCount: 3 },
  { date: '2027-01-01', amount: 33.33, installmentNumber: 2, installmentCount: 3 },
  { date: '2027-02-01', amount: 33.33, installmentNumber: 3, installmentCount: 3 }
], ...extra });

// Credit commits to invoices in integer cents; only invoice payment affects cash.
{
  const data = fresh();
  F.ensureCreditCards(data, '2026-12');
  const rule = data.finance.recurringBills.find(row => row.cardId === 'nubank');
  F.saveRecurring(data, { ...rule, expectedAmount: 0.1 });
  const previous = structuredClone(data), input = purchaseInput();
  const purchase = F.recordCreditPurchase(data, input);
  input.items[0].name = 'Alterado';
  input.installments[0].amount = 0;
  assert.equal(purchase.items[0].name, 'Produto', 'stored history must not alias caller objects');
  assert.equal(data.transactions.length, 0);
  assert.equal(F.currentBalance(data, '2027-02-28'), 0);
  assert.equal(data.finance.bills.find(row => row.id === 'recurring:card:nubank:2026-12').expectedAmount, 33.44);
  assert.equal(data.finance.bills.find(row => row.id === 'recurring:card:nubank:2027-01').expectedAmount, 33.43);
  assert.equal(data.finance.bills.find(row => row.id === 'recurring:card:mercado_pago:2026-12').expectedAmount, 0);
  assert.equal(F.validateFinance(data), true);
  assert.equal(F.validateFinanceChange(previous, data), true);
  F.saveRecurring(data, { ...rule, active: false, startMonth: '2027-05' });
  F.syncMonth(data, '2026-12');
  assert.equal(data.finance.bills.find(row => row.id === 'recurring:card:nubank:2026-12').expectedAmount, 33.34, 'pausing removes only the base');
  const invoice = data.finance.bills.find(row => row.id === 'recurring:card:nubank:2026-12');
  F.payBill(data, invoice.id, { amount: 33.34, date: '2026-12-25', method: 'Pix' });
  F.syncMonth(data, '2026-12');
  assert.equal(data.transactions.length, 1);
  assert.equal(F.currentBalance(data, '2026-12-31'), -33.34);
  assert.equal(F.monthlySummary(data, '2026-12', '2026-12-31').billsPaid, 33.34);
  const snapshot = structuredClone(data);
  assert.throws(() => F.recordCreditPurchase(data, purchaseInput()), /outro mês inicial/i);
  assert.deepEqual(data, snapshot, 'closed-invoice rejection is atomic');
  const removed = structuredClone(data); removed.finance.creditPurchases = [];
  assert.equal(F.validateFinanceChange(data, removed), false);
  const changed = structuredClone(data); changed.finance.creditPurchases[0].description = 'Outro';
  assert.equal(F.validateFinanceChange(data, changed), false);
  const removedRule = structuredClone(data); removedRule.finance.recurringBills = removedRule.finance.recurringBills.filter(row => row.id !== rule.id);
  assert.equal(F.validateFinanceChange(data, removedRule), false, 'purchase card rule cannot be removed');
  const stripped = structuredClone(data); delete stripped.finance;
  assert.equal(F.validateFinanceChange(data, stripped), false);
}

// Invalid new credit schedules fail before initializing or otherwise changing data.
{
  const variants = [
    { cardId: '' }, { cardId: 'unknown' }, { description: '' }, { category: '' },
    { purchaseDate: '2026-02-29' }, { amount: 0 }, { amount: -1 }, { amount: 100.001 }, { amount: NaN },
    { items: null }, { items: [{ name: '', qty: 1, unit: 100 }] },
    { installments: [] }, { installments: purchaseInput().installments.slice(0, 2) },
    { installments: purchaseInput().installments.map((part, index) => ({ ...part, ...(index === 0 ? { date: '2026-11-01' } : {}) })) },
    { installments: purchaseInput().installments.map((part, index) => ({ ...part, ...(index === 1 ? { date: '2027-01-02' } : {}) })) },
    { installments: purchaseInput().installments.map((part, index) => ({ ...part, ...(index === 1 ? { date: '2027-03-01' } : {}) })) },
    { installments: purchaseInput().installments.map(part => ({ ...part, installmentNumber: 1 })) },
    { installments: purchaseInput().installments.map(part => ({ ...part, installmentCount: 4 })) },
    { installments: purchaseInput().installments.map(part => ({ ...part, amount: null })) },
    { installments: [{ date: '2026-12-01', amount: 100, installmentNumber: 1, installmentCount: 2 }, { date: '2027-01-01', amount: 0, installmentNumber: 2, installmentCount: 2 }] }
  ];
  for (const variant of variants) {
    const data = fresh(), snapshot = structuredClone(data);
    assert.throws(() => F.recordCreditPurchase(data, purchaseInput(variant)), JSON.stringify(variant));
    assert.deepEqual(data, snapshot, 'invalid purchases must not initialize finance');
  }
  const data = fresh(); F.ensureCreditCards(data, '2026-12'); F.syncMonth(data, '2026-12');
  F.cancelBill(data, 'recurring:card:nubank:2026-12');
  const snapshot = structuredClone(data);
  assert.throws(() => F.recordCreditPurchase(data, purchaseInput()), /outro mês inicial/i);
  assert.deepEqual(data, snapshot);
}

// Validators are read-only, support legacy documents and enforce card identity/history.
{
  const data = fresh(); F.ensure(data);
  delete data.finance.creditPurchases;
  const snapshot = structuredClone(data);
  assert.equal(F.validateFinance(data), true);
  assert.equal(F.validateFinanceChange(data, data), true);
  assert.deepEqual(data, snapshot);
  F.ensureCreditCards(data, '2026-12');
  const before = structuredClone(data), rule = data.finance.recurringBills[0];
  const omittedMarker = { ...rule }; delete omittedMarker.cardId;
  F.saveRecurring(data, { ...omittedMarker, dueDay: 12 });
  assert.equal(rule.cardId, 'nubank', 'ordinary recurrence edits preserve marker');
  assert.throws(() => F.saveRecurring(data, { ...rule, cardId: 'mercado_pago' }));
  assert.throws(() => F.saveRecurring(data, recurringInput({ cardId: 'nubank' })));
  const changed = structuredClone(data); delete changed.finance.recurringBills[0].cardId;
  assert.equal(F.validateFinanceChange(before, changed), false, 'existing marker cannot be stripped');
  const duplicate = structuredClone(data); duplicate.finance.recurringBills.push({ ...rule, id: 'another' });
  assert.equal(F.validateFinance(duplicate), false);
  const wrongMarker = structuredClone(data); wrongMarker.finance.recurringBills[0].cardId = 'mercado_pago';
  assert.equal(F.validateFinance(wrongMarker), false);
  F.recordCreditPurchase(data, purchaseInput());
  for (const change of [
    copy => { copy.finance.creditPurchases[0].installments[0].amount = 30; },
    copy => { copy.finance.creditPurchases[0].installments[1].date = '2027-02-01'; },
    copy => { copy.finance.creditPurchases.push(structuredClone(copy.finance.creditPurchases[0])); },
    copy => { copy.finance.creditPurchases[0].cardId = 'other'; }
  ]) { const copy = structuredClone(data); change(copy); const frozen = structuredClone(copy); assert.equal(F.validateFinance(copy), false); assert.deepEqual(copy, frozen); }
  const closedPrevious = fresh(); F.ensureCreditCards(closedPrevious, '2026-12'); F.syncMonth(closedPrevious, '2026-12'); F.cancelBill(closedPrevious, 'recurring:card:nubank:2026-12');
  const forged = structuredClone(closedPrevious); forged.finance.creditPurchases.push({ id: 'forged-credit', ...purchaseInput() });
  assert.equal(F.validateFinanceChange(closedPrevious, forged), false, 'server rejects purchases appended into closed months');
}

// Optional card markers and null bases still aggregate exact bank-specific obligations.
{
  const data = fresh(), otherProfile = fresh(); F.ensureCreditCards(data, '2026-12');
  const nubank = data.finance.recurringBills.find(row => row.cardId === 'nubank');
  delete nubank.cardId;
  F.saveRecurring(data, { ...nubank, expectedAmount: null, dueDay: 31 });
  const onePart = (amount, cardId = 'nubank') => purchaseInput({ cardId, amount, items: [], installments: [{ date: '2026-12-01', amount, installmentNumber: 1, installmentCount: 1 }] });
  F.recordCreditPurchase(data, onePart(0.1));
  F.recordCreditPurchase(data, onePart(0.2));
  F.recordCreditPurchase(data, onePart(7.89, 'mercado_pago'));
  assert.equal(data.finance.bills.find(row => row.sourceId === 'card:nubank').expectedAmount, 0.3);
  assert.equal(data.finance.bills.find(row => row.sourceId === 'card:mercado_pago').expectedAmount, 7.89);
  assert.equal(F.monthlySummary(data, '2026-12', '2026-12-31').pending, 8.19);
  assert.equal(F.currentBalance(otherProfile, '2026-12-31'), 0);
  assert.equal(otherProfile.finance.creditPurchases.length, 0);
  F.ensureCreditCards(data, '2027-02');
  assert.equal(data.finance.recurringBills.length, 2, 'markerless canonical rule is not duplicated');
  assert.equal(F.validateFinance(data), true);
}

// Maximum schedules are allowed, while overflow, excessive parts and bad totals are atomic.
{
  const data = fresh();
  const installments = Array.from({ length: 120 }, (_, index) => ({ date: `${2026 + Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, '0')}-01`, amount: 0.01, installmentNumber: index + 1, installmentCount: 120 }));
  F.recordCreditPurchase(data, purchaseInput({ purchaseDate: '2026-01-31', amount: 1.2, items: [], installments }));
  assert.equal(data.finance.bills.find(row => row.id === 'recurring:card:nubank:2035-12').expectedAmount, 0.01);
  assert.equal(F.validateFinance(data), true);
  const excessive = purchaseInput({ purchaseDate: '2026-01-31', amount: 1.21, installments: [...installments, { date: '2036-01-01', amount: 0.01, installmentNumber: 121, installmentCount: 121 }].map(part => ({ ...part, installmentCount: 121 })) });
  const snapshot = structuredClone(data);
  assert.throws(() => F.recordCreditPurchase(data, excessive)); assert.deepEqual(data, snapshot);
  const overflow = fresh(); F.ensureCreditCards(overflow, '2026-12');
  const rule = overflow.finance.recurringBills[0];
  F.saveRecurring(overflow, { ...rule, expectedAmount: 90071992547409.9 });
  const before = structuredClone(overflow);
  assert.throws(() => F.recordCreditPurchase(overflow, purchaseInput()));
  assert.deepEqual(overflow, before, 'aggregate amount overflow must not append a purchase');
}

// Purchase debt cannot disappear through missing or understated generated invoices.
{
  const previous = fresh(); F.ensureCreditCards(previous, '2026-12');
  const next = structuredClone(previous); F.recordCreditPurchase(next, purchaseInput());
  for (const mutate of [
    copy => { copy.finance.bills = copy.finance.bills.filter(row => row.id !== 'recurring:card:nubank:2027-01'); },
    copy => { copy.finance.bills.find(row => row.id === 'recurring:card:nubank:2027-01').expectedAmount = 0; },
    copy => { copy.finance.bills.find(row => row.id === 'recurring:card:nubank:2027-01').expectedAmount = null; },
    copy => { copy.finance.bills.find(row => row.id === 'recurring:card:nubank:2027-01').expectedAmount = 50; }
  ]) {
    const forged = structuredClone(next); mutate(forged);
    const frozen = structuredClone(forged), before = structuredClone(previous);
    assert.equal(F.validateFinance(forged), false, 'purchase requires an invoice with its complete expected amount');
    assert.equal(F.validateFinanceChange(previous, forged), false);
    assert.equal(F.validateFinanceChange(next, forged), false, 'existing debt cannot be stripped either');
    assert.deepEqual(forged, frozen); assert.deepEqual(previous, before);
  }
}

// Editing card recurrence updates every pending purchase month without rewriting closed history.
{
  const previous = fresh(); F.ensureCreditCards(previous, '2026-12');
  const next = structuredClone(previous); F.recordCreditPurchase(next, purchaseInput());
  F.payBill(next, 'recurring:card:nubank:2026-12', { amount: 1, date: '2026-12-25', method: 'Pix' });
  F.cancelBill(next, 'recurring:card:nubank:2027-01');
  assert.equal(F.validateFinanceChange(previous, next), true, 'actual payment can differ from correct invoice estimate');
  for (const month of ['2026-12', '2027-01']) {
    const forged = structuredClone(next); forged.finance.bills.find(row => row.id === `recurring:card:nubank:${month}`).expectedAmount = 0;
    const frozen = structuredClone(forged);
    assert.equal(F.validateFinanceChange(previous, forged), false, 'newly closed invoices must retain complete expected debt');
    assert.deepEqual(forged, frozen);
  }
  const changed = structuredClone(next), rule = changed.finance.recurringBills.find(row => row.cardId === 'nubank');
  rule.expectedAmount = 10;
  changed.finance.bills.find(row => row.id === 'recurring:card:nubank:2026-12').expectedAmount = 43.34;
  changed.finance.bills.find(row => row.id === 'recurring:card:nubank:2027-01').expectedAmount = 43.33;
  changed.finance.bills.find(row => row.id === 'recurring:card:nubank:2027-02').expectedAmount = 43.33;
  assert.equal(F.validateFinanceChange(previous, changed), true, 'same-save closures use updated recurring base');
}

// Editing card recurrence updates every pending purchase month without rewriting closed history.
{
  const data = fresh(); F.ensureCreditCards(data, '2026-12'); F.recordCreditPurchase(data, purchaseInput());
  F.payBill(data, 'recurring:card:nubank:2026-12', { amount: 33.34, date: '2026-12-25', method: 'Pix' });
  F.cancelBill(data, 'recurring:card:nubank:2027-02');
  const before = structuredClone(data), rule = data.finance.recurringBills.find(row => row.cardId === 'nubank');
  F.saveRecurring(data, { ...rule, expectedAmount: 10.25, dueDay: 20 });
  assert.equal(data.finance.bills.find(row => row.id === 'recurring:card:nubank:2027-01').expectedAmount, 43.58, 'future pending invoices include edited base immediately');
  assert.equal(data.finance.bills.find(row => row.id === 'recurring:card:nubank:2027-01').dueDate, '2027-01-20');
  assert.deepEqual(data.finance.bills.find(row => row.id === 'recurring:card:nubank:2026-12'), before.finance.bills.find(row => row.id === 'recurring:card:nubank:2026-12'));
  assert.deepEqual(data.finance.bills.find(row => row.id === 'recurring:card:nubank:2027-02'), before.finance.bills.find(row => row.id === 'recurring:card:nubank:2027-02'));
  const frozen = structuredClone(data);
  assert.equal(F.validateFinanceChange(before, data), true); assert.deepEqual(data, frozen);
  F.saveRecurring(data, { ...rule, active: false });
  assert.equal(data.finance.bills.find(row => row.id === 'recurring:card:nubank:2027-01').expectedAmount, 33.33);
  assert.equal(F.validateFinance(data), true);
  const snapshot = structuredClone(data);
  assert.throws(() => F.saveRecurring(data, { ...rule, active: true, expectedAmount: 90071992547409.9 }));
  assert.deepEqual(data, snapshot, 'recurrence aggregate overflow fails before mutation');
}

// Older unsynchronized recurring estimates without identified purchase debt remain valid.
{
  const data = fresh(); F.ensureCreditCards(data, '2026-12');
  F.recordCreditPurchase(data, purchaseInput({ amount: 1, items: [], installments: [{ date: '2026-12-01', amount: 1, installmentNumber: 1, installmentCount: 1 }] }));
  F.payBill(data, 'recurring:card:nubank:2026-12', { amount: 1, date: '2026-12-25', method: 'Pix' });
  const before = structuredClone(data), rule = data.finance.recurringBills.find(row => row.cardId === 'nubank');
  F.saveRecurring(data, { ...rule, expectedAmount: 90071992547409.9 });
  assert.equal(F.validateFinanceChange(before, data), true, 'historical paid invoice is independent of later base projections');
  assert.deepEqual(data.finance.bills.find(row => row.id === 'recurring:card:nubank:2026-12'), before.finance.bills.find(row => row.id === 'recurring:card:nubank:2026-12'));
}

// Older unsynchronized recurring estimates without identified purchase debt remain valid.
{
  const data = fresh(); F.ensureCreditCards(data, '2026-12'); F.syncMonth(data, '2027-01');
  data.finance.recurringBills.find(row => row.cardId === 'nubank').expectedAmount = 25;
  const before = structuredClone(data);
  assert.equal(F.validateFinance(data), true);
  assert.equal(F.validateFinanceChange(data, data), true);
  assert.deepEqual(data, before);
}

console.log('Finance core checks passed.');
