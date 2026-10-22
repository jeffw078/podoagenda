import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { prepareExpenseRemoval, expenseHistoryUnchanged } from '../lib/expense-removals.js';

const context = vm.createContext({ console, Date, Intl, Math, JSON, Number, String, Boolean, structuredClone, BigInt,
  crypto: { randomUUID: (() => { let index = 0; return () => `audit-${++index}`; })() } });
vm.runInContext(fs.readFileSync(new URL('../src/shared/finance-core.js', import.meta.url), 'utf8'), context);
const Core = context.FinanceCore;
const purchase = () => ({ cardId: 'nubank', description: 'Celular', category: 'Eletrônicos', purchaseDate: '2026-10-10', amount: 30, items: [], installments: [
  { date: '2026-10-01', amount: 15, installmentNumber: 1, installmentCount: 2 },
  { date: '2026-11-01', amount: 15, installmentNumber: 2, installmentCount: 2 }
] });
const baseData = () => ({ transactions: [], finance: { version: 1, openingBalance: null, adjustments: [], monthlyPlans: [], recurringBills: [], bills: [], creditPurchases: [] } });

// Credit removal archives the complete record and edits, updates open invoices, and leaves a paid snapshot intact.
{
  const original = baseData();
  original.finance.cardInvoiceImport = { source: 'receipt-import', opaque: { keep: true } };
  Core.ensureCreditCards(original, '2026-10');
  const created = Core.recordCreditPurchase(original, purchase());
  Core.editCreditInstallments(original, created.id, { reason: 'Ajuste solicitado', installments: [
    { date: '2026-10-01', amount: 14, installmentNumber: 1, installmentCount: 2 },
    { date: '2026-11-01', amount: 16, installmentNumber: 2, installmentCount: 2 }
  ] });
  Core.payBill(original, 'recurring:card:nubank:2026-10', { amount: 14, date: '2026-10-20', method: 'Pix' });
  const before = structuredClone(original), closedInvoice = structuredClone(original.finance.bills.find(row => row.month === '2026-10' && row.sourceId === 'card:nubank'));
  const result = prepareExpenseRemoval(original, { kind: 'credit', id: created.id, reason: 'Compra cancelada' }, 'admin@example.test', '2026-10-22T12:30:00.000Z', Core);
  assert.equal(original.finance.creditPurchases.length, 1, 'input remains unchanged');
  assert.equal(JSON.stringify(original), JSON.stringify(before), 'input remains byte-for-byte equivalent');
  assert.equal(result.data.finance.creditPurchases.length, 0);
  assert.equal(result.data.finance.creditEdits.length, 0);
  assert.equal(result.audit.record.purchase.id, created.id);
  assert.equal(result.audit.record.creditEdits.length, 1);
  assert.equal(JSON.stringify(result.data.finance.bills.find(row => row.id === closedInvoice.id)), JSON.stringify(closedInvoice), 'paid invoice snapshot remains unchanged');
  assert.equal(result.data.finance.bills.find(row => row.id === 'recurring:card:nubank:2026-11').expectedAmount, 0);
  assert.deepEqual(result.data.finance.cardInvoiceImport, original.finance.cardInvoiceImport);
  assert.equal(result.data.transactions.length, 1, 'payment transaction remains part of historical ledger');
  assert.equal(Core.validateFinance(result.data), true);
}

// Removing a linked cash expense reopens only its bill; unrelated payments and income survive.
{
  const original = baseData();
  const bill = Core.createBill(original, { month: '2026-10', dueDate: '2026-10-25', description: 'Material', category: 'Clínica', expectedAmount: 80 });
  Core.payBill(original, bill.id, { amount: 75, date: '2026-10-21', method: 'Pix' });
  original.transactions.push({ id: 'income', type: 'income', description: 'Consulta', amount: 500, date: '2026-10-22' });
  const paymentId = original.transactions.find(row => row.billId === bill.id).id;
  const otherExpense = { id: 'other-expense', type: 'expense', description: 'Café', amount: 4, date: '2026-10-22' };
  original.transactions.push(otherExpense);
  const result = prepareExpenseRemoval(original, { kind: 'transaction', id: paymentId, reason: 'Pagamento lançado em duplicidade' }, 'admin@example.test', '2026-10-22T12:30:00Z', Core);
  const restored = result.data.finance.bills.find(row => row.id === bill.id);
  assert.equal(restored.status, 'pending');
  assert.equal(restored.paidAmount, null);
  assert.equal(restored.transactionId, null);
  assert.equal(restored.paidDate, null);
  assert.equal(result.data.transactions.some(row => row.id === paymentId), false);
  assert.equal(result.data.transactions.some(row => row.id === 'income'), true);
  assert.equal(JSON.stringify(result.data.transactions.find(row => row.id === 'other-expense')), JSON.stringify(otherExpense));
  assert.equal(JSON.stringify(result.audit.record.bill.before), JSON.stringify(bill));
  assert.equal(Core.validateFinance(result.data), true);
  assert.equal(expenseHistoryUnchanged(original, result.data), false, 'admin removal is detectable by generic-save guard');
  const ordinaryEdit = structuredClone(original); ordinaryEdit.transactions.find(row => row.type === 'income').amount++;
  assert.equal(expenseHistoryUnchanged(original, ordinaryEdit), true, 'income changes are outside this expense guard');
}

// Unlinked expenses can be removed, but income rows, missing IDs, malformed reasons and dates cannot.
{
  const original = baseData(); original.transactions = [
    { id: 'expense', type: 'expense', description: 'Despesa', amount: 10, date: '2026-10-01' },
    { id: 'income', type: 'income', description: 'Receita', amount: 10, date: '2026-10-01' }
  ];
  const result = prepareExpenseRemoval(original, { kind: 'transaction', id: 'expense', reason: 'Remover' }, 'admin', '2026-10-22T12:30:00Z', Core);
  assert.equal(result.data.transactions.length, 1);
  for (const input of [
    { kind: 'transaction', id: 'income', reason: 'Remover' }, { kind: 'credit', id: 'missing', reason: 'Remover' },
    { kind: 'other', id: 'expense', reason: 'Remover' }, { kind: 'transaction', id: 'expense', reason: ' ' },
    { kind: 'transaction', id: 'expense', reason: 'x'.repeat(501) }
  ]) assert.throws(() => prepareExpenseRemoval(original, input, 'admin', '2026-10-22T12:30:00Z', Core));
  assert.throws(() => prepareExpenseRemoval(original, { kind: 'transaction', id: 'expense', reason: 'ok' }, '', '2026-10-22T12:30:00Z', Core));
  assert.throws(() => prepareExpenseRemoval(original, { kind: 'transaction', id: 'expense', reason: 'ok' }, 'admin', 'bad-date', Core));
}

console.log('Expense removal checks passed.');
const unordered={transactions:[{id:'x',type:'expense',amount:10,description:'X',date:'2026-10-01'}]};
const reordered={transactions:[{date:'2026-10-01',description:'X',amount:10,type:'expense',id:'x'}]};
assert.equal(expenseHistoryUnchanged(unordered,reordered),true,'JSONB key order does not invalidate an unchanged expense');
assert.equal(expenseHistoryUnchanged(unordered,{...reordered,finance:{expenseRemovals:[{id:'forged'}]}}),false,'Generic saves cannot forge the removal audit');
assert.equal(expenseHistoryUnchanged(unordered,{...reordered,finance:{bankStatementImports:[{id:'forged'}]}}),false,'Generic saves cannot forge the bank reconciliation audit');
