const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const clone = value => typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
const same=(a,b)=>{
  if(a===b)return true;
  if(Array.isArray(a)&&Array.isArray(b))return a.length===b.length&&a.every((value,index)=>same(value,b[index]));
  if(!record(a)||!record(b))return false;
  const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(key=>Object.hasOwn(b,key)&&same(a[key],b[key]));
};

function validServerTime(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) && Number.isFinite(Date.parse(value));
}

function prepareExpenseRemoval(data, input, actor, nowISO, FinanceCore) {
  if (!record(data) || !record(input) || !['credit', 'transaction'].includes(input.kind) || !text(input.id) || !text(input.reason) || input.reason.trim().length > 500 || !text(actor) || !validServerTime(nowISO)) {
    throw new TypeError('Dados da remoção inválidos.');
  }
  if (!FinanceCore || typeof FinanceCore.validateFinance !== 'function') throw new TypeError('FinanceCore inválido.');
  const next = clone(data);
  const finance = FinanceCore.ensure(next);
  if (!record(finance)) throw new TypeError('Documento financeiro inválido.');
  const audit = {
    id: globalThis.crypto.randomUUID(), kind: input.kind, targetId: input.id,
    actor: actor.trim(), reason: input.reason.trim(), removedAt: nowISO
  };

  if (input.kind === 'credit') {
    const purchases = finance.creditPurchases || [];
    const index = purchases.findIndex(row => row.id === input.id);
    if (index < 0) throw new TypeError('Compra no crédito não encontrada.');
    const [purchase] = purchases.splice(index, 1);
    const edits = finance.creditEdits || [];
    const removedEdits = edits.filter(row => row.purchaseId === input.id);
    finance.creditEdits = edits.filter(row => row.purchaseId !== input.id);
    audit.record = { purchase, creditEdits: removedEdits };
    finance.expenseRemovals ||= [];
    if (!Array.isArray(finance.expenseRemovals)) throw new TypeError('Histórico de remoções inválido.');
    finance.expenseRemovals.push(audit);
    for (const month of new Set(purchase.installments.map(part => part.date.slice(0, 7)))) FinanceCore.syncMonth(next, month);
  } else {
    if (!Array.isArray(next.transactions)) throw new TypeError('Movimentações inválidas.');
    const index = next.transactions.findIndex(row => row.id === input.id);
    if (index < 0 || next.transactions[index].type !== 'expense') throw new TypeError('Despesa não encontrada.');
    const [transaction] = next.transactions.splice(index, 1);
    let bill = null;
    if (transaction.billId !== undefined) {
      const billIndex = finance.bills.findIndex(row => row.id === transaction.billId);
      if (billIndex < 0) throw new TypeError('Conta vinculada não encontrada.');
      bill = finance.bills[billIndex];
      if (bill.status !== 'paid' || bill.transactionId !== transaction.id) throw new TypeError('Pagamento vinculado inconsistente.');
      finance.bills[billIndex] = { ...bill, status: 'pending', paidAmount: null, transactionId: null, paidDate: null };
      bill = { before: bill };
    }
    audit.record = { transaction, ...(bill ? { bill } : {}) };
    finance.expenseRemovals ||= [];
    if (!Array.isArray(finance.expenseRemovals)) throw new TypeError('Histórico de remoções inválido.');
    finance.expenseRemovals.push(audit);
    if (bill) FinanceCore.syncMonth(next, bill.before.month);
  }

  if (!FinanceCore.validateFinance(next)) throw new TypeError('A remoção produziria dados financeiros inválidos.');
  return { data: next, audit };
}

function expenseHistoryUnchanged(previous, next) {
  if(!same(previous?.finance?.expenseRemovals||[],next?.finance?.expenseRemovals||[]))return false;
  const oldExpenses = (previous?.transactions || []).filter(row => row?.type === 'expense');
  const newExpenses = (next?.transactions || []).filter(row => row?.type === 'expense');
  const remaining = newExpenses.slice();
  return oldExpenses.every(row => {
    const index = remaining.findIndex(candidate => candidate?.id === row.id && same(candidate,row));
    if (index < 0) return false;
    remaining.splice(index, 1);
    return true;
  });
}

export { prepareExpenseRemoval, expenseHistoryUnchanged };
