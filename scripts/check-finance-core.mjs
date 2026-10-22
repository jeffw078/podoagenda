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

console.log('Finance core checks passed.');
