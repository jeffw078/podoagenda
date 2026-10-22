(function () {
  'use strict';

  const fail = message => { throw new Error(message); };
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const text = value => typeof value === 'string' && value.trim().length > 0;
  const id = () => globalThis.crypto.randomUUID();
  const today = () => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };
  const validMonth = value => typeof value === 'string' && /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(value);
  const month = value => validMonth(value) ? value : fail('Mês inválido.');
  function daysInMonth(value) {
    const year = Number(value.slice(0, 4)), number = Number(value.slice(5, 7));
    if (number === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
    return [4, 6, 9, 11].includes(number) ? 30 : 31;
  }
  const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && validMonth(value.slice(0, 7)) && Number(value.slice(8)) >= 1 && Number(value.slice(8)) <= daysInMonth(value.slice(0, 7));
  const date = value => validDate(value) ? value : fail('Data inválida.');
  const day = value => Number.isInteger(value) && value >= 1 && value <= 31 ? value : fail('Dia de vencimento inválido.');
  function cents(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) fail('Valor inválido.');
    // Decimal digits avoid 10.075 becoming 10.07 through binary multiplication.
    const [coefficient, exponent = '0'] = Math.abs(value).toString().toLowerCase().split('e');
    const [whole, fraction = ''] = coefficient.split('.');
    const digits = BigInt(whole + fraction), shift = 2 + Number(exponent) - fraction.length;
    let rounded;
    if (shift >= 0) rounded = digits * (10n ** BigInt(shift));
    else {
      const divisor = 10n ** BigInt(-shift);
      rounded = digits / divisor + (digits % divisor * 2n >= divisor ? 1n : 0n);
    }
    const result = Math.sign(value) * Number(rounded);
    if (!Number.isSafeInteger(result)) fail('Valor fora do limite permitido.');
    return result === 0 ? 0 : result;
  }
  const money = value => cents(value) / 100;
  const positive = value => { if (!(value > 0)) fail('Informe um valor positivo.'); return money(value); };
  const nonnegative = value => { if (typeof value !== 'number' || value < 0) fail('Valor inválido.'); return money(value); };
  const nullableMoney = value => value === null ? null : nonnegative(value);
  // Stored amounts must already be rounded, while entry points accept fractional cents.
  const validMoney = value => {
    try { return typeof value === 'number' && money(value) === value; }
    catch { return false; }
  };
  const dueDate = (value, dueDay) => `${value}-${String(Math.min(day(dueDay), daysInMonth(value))).padStart(2, '0')}`;
  const empty = () => ({ version: 1, openingBalance: null, adjustments: [], monthlyPlans: [], recurringBills: [], bills: [] });

  function ensure(data) {
    if (!object(data)) fail('Documento inválido.');
    if (data.finance === undefined) data.finance = empty();
    if (!object(data.finance) || data.finance.version !== 1 || !['adjustments', 'monthlyPlans', 'recurringBills', 'bills'].every(key => Array.isArray(data.finance[key]))) fail('Dados financeiros inválidos.');
    return data.finance;
  }
  function transactions(data) {
    if (data.transactions === undefined) return [];
    if (!Array.isArray(data.transactions)) fail('Movimentações inválidas.');
    return data.transactions;
  }
  function sumTransactions(data, asOf) {
    let result = 0;
    for (const row of transactions(data)) {
      if (!validDate(row.date) || row.date > asOf || !['income', 'expense'].includes(row.type)) continue;
      result += cents(row.amount) * (row.type === 'income' ? 1 : -1);
      if (!Number.isSafeInteger(result)) fail('Saldo fora do limite permitido.');
    }
    return result;
  }
  function normalizePlan(value, input) {
    month(value);
    if (!object(input) || !['amount', 'percentage'].includes(input.reserveMode)) fail('Plano mensal inválido.');
    const expectedIncome = nonnegative(input.expectedIncome), reserveValue = nonnegative(input.reserveValue);
    if (input.reserveMode === 'percentage' && input.reserveValue > 100) fail('Percentual deve estar entre 0 e 100.');
    return { month: value, expectedIncome, reserveMode: input.reserveMode, reserveValue, reserveDueDay: day(input.reserveDueDay) };
  }
  function setMonthPlan(data, value, input) {
    const plan = normalizePlan(value, input), finance = ensure(data);
    const index = finance.monthlyPlans.findIndex(row => row.month === value);
    if (index < 0) finance.monthlyPlans.push(plan); else finance.monthlyPlans[index] = plan;
    syncMonth(data, value);
    return plan;
  }
  function normalizeRecurring(input) {
    if (!object(input) || !text(input.description) || !text(input.category) || typeof input.fixed !== 'boolean' || typeof input.active !== 'boolean') fail('Recorrência inválida.');
    const expectedAmount = nullableMoney(input.expectedAmount);
    if (input.fixed && expectedAmount === null) fail('Informe o valor da conta fixa.');
    const startMonth = month(input.startMonth), endMonth = input.endMonth === null ? null : month(input.endMonth);
    if (endMonth && endMonth < startMonth) fail('O fim deve ser posterior ao início.');
    return { description: input.description.trim(), category: input.category.trim(), fixed: input.fixed, expectedAmount, dueDay: day(input.dueDay), startMonth, endMonth, active: input.active };
  }
  function saveRecurring(data, input) {
    const normalized = normalizeRecurring(input), finance = ensure(data);
    if (input.id !== undefined && !text(input.id)) fail('Identificador inválido.');
    const existing = input.id === undefined ? null : finance.recurringBills.find(row => row.id === input.id);
    if (input.id !== undefined && !existing) fail('Recorrência não encontrada.');
    if (existing) { Object.assign(existing, normalized); return existing; }
    const rule = { id: id(), ...normalized };
    finance.recurringBills.push(rule);
    return rule;
  }
  function billRecord(input) {
    if (!object(input) || !text(input.description) || !text(input.category)) fail('Informe descrição e categoria.');
    const validDue = date(input.dueDate), value = input.month === undefined ? validDue.slice(0, 7) : month(input.month);
    if (value !== validDue.slice(0, 7)) fail('Vencimento fora do mês da conta.');
    return { month: value, dueDate: validDue, description: input.description.trim(), category: input.category.trim(), expectedAmount: nullableMoney(input.expectedAmount), paidAmount: null, status: 'pending', transactionId: null, paidDate: null };
  }
  function createBill(data, input) {
    const record = billRecord(input), finance = ensure(data);
    const bill = { id: id(), ...record, source: 'manual', sourceId: null };
    finance.bills.push(bill);
    return bill;
  }
  function syncMonth(data, value) {
    month(value);
    const finance = ensure(data), wanted = new Map();
    for (const rule of finance.recurringBills) {
      if (!rule.active || value < rule.startMonth || (rule.endMonth && value > rule.endMonth)) continue;
      wanted.set(`recurring:${rule.id}:${value}`, { source: 'recurring', sourceId: rule.id, description: rule.description, category: rule.category, expectedAmount: rule.expectedAmount, dueDate: dueDate(value, rule.dueDay) });
    }
    const plan = finance.monthlyPlans.find(row => row.month === value);
    if (plan) {
      const amount = plan.reserveMode === 'percentage'
        ? Number((BigInt(cents(plan.expectedIncome)) * BigInt(cents(plan.reserveValue)) + 5000n) / 10000n) / 100
        : plan.reserveValue;
      if (amount > 0) wanted.set(`reserve:${value}`, { source: 'reserve', sourceId: value, description: 'Reserva mensal', category: 'Reserva', expectedAmount: amount, dueDate: dueDate(value, plan.reserveDueDay) });
    }
    // Disabled rules/reserves disappear only while pending; paid/cancelled history is retained.
    finance.bills = finance.bills.filter(bill => bill.month !== value || bill.source === 'manual' || bill.status !== 'pending' || wanted.has(bill.id));
    for (const [billId, input] of wanted) {
      const bill = finance.bills.find(row => row.id === billId);
      if (bill) { if (bill.status === 'pending') Object.assign(bill, input); }
      else finance.bills.push({ id: billId, ...billRecord({ ...input, month: value }), source: input.source, sourceId: input.sourceId });
    }
    return finance.bills.filter(bill => bill.month === value);
  }
  function pendingBill(data, billId) {
    const bill = ensure(data).bills.find(row => row.id === billId);
    if (!bill) fail('Conta não encontrada.');
    if (bill.status !== 'pending') fail('A conta já foi paga ou cancelada.');
    return bill;
  }
  function cancelBill(data, billId) {
    const bill = pendingBill(data, billId);
    bill.status = 'cancelled';
    return bill;
  }
  function payBill(data, billId, input) {
    if (!object(input) || !text(input.method)) fail('Informe a forma de pagamento.');
    const amount = positive(input.amount), paidDate = date(input.date);
    if (amount <= 0) fail('Informe pelo menos R$ 0,01.');
    const bill = pendingBill(data, billId), rows = transactions(data);
    if (rows.some(row => row.billId === billId)) fail('Pagamento já registrado.');
    const transaction = { id: id(), type: 'expense', description: bill.description, category: bill.category, amount, date: paidDate, method: input.method.trim(), billId, financeKind: bill.source === 'reserve' ? 'reserve' : 'bill' };
    if (!data.transactions) data.transactions = rows;
    rows.push(transaction);
    Object.assign(bill, { paidAmount: amount, status: 'paid', transactionId: transaction.id, paidDate });
    return bill;
  }
  function currentBalance(data, asOf = today()) {
    date(asOf);
    const finance = ensure(data), opening = finance.openingBalance;
    let total = sumTransactions(data, asOf);
    if (opening && opening.date <= asOf) total += cents(opening.amount) - cents(opening.baseline);
    for (const adjustment of finance.adjustments) if (adjustment.date <= asOf) total += cents(adjustment.delta);
    if (!Number.isSafeInteger(total)) fail('Saldo fora do limite permitido.');
    return total / 100;
  }
  function setCurrentBalance(data, amount, value, reason = '') {
    const normalized = money(amount), balanceDate = date(value), finance = ensure(data);
    if (!finance.openingBalance) {
      finance.openingBalance = { amount: normalized, date: balanceDate, baseline: sumTransactions(data, balanceDate) / 100 };
      return finance.openingBalance;
    }
    if (!text(reason)) fail('Informe o motivo da correção de saldo.');
    if (balanceDate < finance.openingBalance.date || finance.adjustments.some(row => row.date > balanceDate)) fail('A correção deve ter data igual ou posterior à última conferência.');
    const before = currentBalance(data, balanceDate);
    const adjustment = { id: id(), date: balanceDate, delta: (cents(normalized) - cents(before)) / 100, before, after: normalized, reason: reason.trim(), createdAt: new Date().toISOString() };
    finance.adjustments.push(adjustment);
    return adjustment;
  }
  function monthlySummary(data, value, asOf = today()) {
    month(value); date(asOf);
    const finance = ensure(data);
    let income = 0, spending = 0, billsPaid = 0, reserved = 0, pending = 0, pendingUnknown = 0, reserveExpected = 0;
    for (const row of transactions(data)) {
      if (!validDate(row.date) || !row.date.startsWith(value) || row.date > asOf) continue;
      const amount = cents(row.amount);
      if (row.type === 'income') income += amount;
      else if (row.type === 'expense') {
        if (row.financeKind === 'reserve') reserved += amount;
        else if (row.financeKind === 'bill' || row.billId) billsPaid += amount;
        else spending += amount;
      }
    }
    for (const bill of finance.bills.filter(row => row.month === value && row.status !== 'cancelled')) {
      if (bill.source === 'reserve' && bill.expectedAmount !== null) reserveExpected += cents(bill.expectedAmount);
      if (bill.status === 'paid' && bill.paidDate > asOf) {
        pending += cents(bill.paidAmount);
        continue;
      }
      if (bill.status !== 'pending') continue;
      if (bill.expectedAmount === null) pendingUnknown++; else pending += cents(bill.expectedAmount);
    }
    const balance = currentBalance(data, asOf);
    return { income: income / 100, spending: spending / 100, billsPaid: billsPaid / 100, reserved: reserved / 100, pending: pending / 100, pendingUnknown, reserveExpected: reserveExpected / 100, balance, freeAfterBills: (cents(balance) - pending) / 100 };
  }

  const same = (a, b) => {
    if (a === b) return true;
    if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, index) => same(value, b[index]));
    if (!object(a) || !object(b)) return false;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && same(a[key], b[key]));
  };
  const unique = (rows, key) => rows.every(row => object(row) && text(row[key])) && new Set(rows.map(row => row[key])).size === rows.length;
  function validateFinance(data) {
    try {
      if (!object(data)) return false;
      if (data.finance === undefined) return true;
      const finance = data.finance;
      if (!object(finance) || finance.version !== 1 || !['adjustments', 'monthlyPlans', 'recurringBills', 'bills'].every(key => Array.isArray(finance[key]))) return false;
      if (!unique(finance.adjustments, 'id') || !unique(finance.monthlyPlans, 'month') || !unique(finance.recurringBills, 'id') || !unique(finance.bills, 'id')) return false;
      const opening = finance.openingBalance;
      if (opening !== null && (!object(opening) || !validMoney(opening.amount) || !validMoney(opening.baseline) || !validDate(opening.date))) return false;
      if (!opening && finance.adjustments.length) return false;
      let lastDate = opening?.date;
      for (const adjustment of finance.adjustments) {
        if (!validDate(adjustment.date) || adjustment.date < lastDate || !text(adjustment.reason) || ![adjustment.delta, adjustment.before, adjustment.after].every(validMoney) || cents(adjustment.after) - cents(adjustment.before) !== cents(adjustment.delta) || typeof adjustment.createdAt !== 'string' || !Number.isFinite(Date.parse(adjustment.createdAt))) return false;
        lastDate = adjustment.date;
      }
      for (const plan of finance.monthlyPlans) if (!same(plan, normalizePlan(plan.month, plan))) return false;
      for (const rule of finance.recurringBills) if (!same(rule, { id: rule.id, ...normalizeRecurring(rule) })) return false;
      const generated = new Set();
      const rowsById = new Map(), rowsByBill = new Map(), billsById = new Map(finance.bills.map(bill => [bill.id, bill]));
      for (const row of transactions(data)) {
        if (!object(row)) return false;
        if (!rowsById.has(row.id)) rowsById.set(row.id, []);
        rowsById.get(row.id).push(row);
        if (row.billId !== undefined) {
          if (!rowsByBill.has(row.billId)) rowsByBill.set(row.billId, []);
          rowsByBill.get(row.billId).push(row);
        }
      }
      for (const bill of finance.bills) {
        if (!validMonth(bill.month) || !validDate(bill.dueDate) || bill.dueDate.slice(0, 7) !== bill.month || !text(bill.description) || !text(bill.category) || !(bill.expectedAmount === null || validMoney(bill.expectedAmount) && bill.expectedAmount >= 0) || !['pending', 'paid', 'cancelled'].includes(bill.status) || !['manual', 'recurring', 'reserve'].includes(bill.source)) return false;
        if (bill.source === 'manual' ? bill.sourceId !== null : !text(bill.sourceId)) return false;
        if (bill.source !== 'manual') {
          if (bill.source === 'recurring' && bill.id !== `recurring:${bill.sourceId}:${bill.month}`) return false;
          if (bill.source === 'reserve' && (bill.id !== `reserve:${bill.month}` || bill.sourceId !== bill.month)) return false;
          const key = `${bill.source}:${bill.sourceId}:${bill.month}`;
          if (generated.has(key)) return false;
          generated.add(key);
        }
        if (bill.status === 'paid') {
          if (!validMoney(bill.paidAmount) || bill.paidAmount <= 0 || !validDate(bill.paidDate) || !text(bill.transactionId)) return false;
          const rows = [...new Set([...(rowsById.get(bill.transactionId) || []), ...(rowsByBill.get(bill.id) || [])])];
          if (rows.length !== 1) return false;
          const row = rows[0];
          if (row.id !== bill.transactionId || row.billId !== bill.id || row.type !== 'expense' || row.amount !== bill.paidAmount || row.date !== bill.paidDate || row.financeKind !== (bill.source === 'reserve' ? 'reserve' : 'bill')) return false;
        } else if (bill.paidAmount !== null || bill.transactionId !== null || bill.paidDate !== null) return false;
      }
      for (const row of transactions(data)) {
        if (row.billId === undefined && row.financeKind === undefined) continue;
        const bill = billsById.get(row.billId);
        if (!bill || bill.status !== 'paid' || bill.transactionId !== row.id) return false;
      }
      return true;
    } catch { return false; }
  }
  function validateFinanceChange(previous, next) {
    if (!validateFinance(previous) || !validateFinance(next)) return false;
    const before = previous.finance || empty(), after = next.finance;
    if (!after) return before.openingBalance === null && before.adjustments.length === 0 && before.bills.length === 0;
    if (before.openingBalance !== null && !same(before.openingBalance, after.openingBalance)) return false;
    if (after.adjustments.length < before.adjustments.length || !before.adjustments.every((row, index) => same(row, after.adjustments[index]))) return false;
    try {
      if (before.openingBalance === null && after.openingBalance !== null && cents(after.openingBalance.baseline) !== sumTransactions(next, after.openingBalance.date)) return false;
      // Check only appended snapshots. Historical transaction edits intentionally affect
      // today's ledger without rewriting the audit snapshots from earlier saves.
      const accounting = { ...next, finance: { ...after, adjustments: after.adjustments.slice(0, before.adjustments.length) } };
      for (const adjustment of after.adjustments.slice(before.adjustments.length)) {
        if (cents(adjustment.before) !== cents(currentBalance(accounting, adjustment.date))) return false;
        accounting.finance.adjustments.push(adjustment);
      }
    } catch { return false; }
    return before.bills.every(bill => {
      if (bill.status !== 'paid' && !(bill.status === 'cancelled' && bill.source !== 'manual')) return true;
      return same(bill, after.bills.find(row => row.id === bill.id));
    });
  }

  globalThis.FinanceCore = Object.freeze({ ensure, syncMonth, setMonthPlan, saveRecurring, createBill, cancelBill, payBill, currentBalance, setCurrentBalance, monthlySummary, validateFinance, validateFinanceChange });
})();
