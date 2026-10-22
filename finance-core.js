(function () {
  'use strict';

  const fail = message => { throw new Error(message); };
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const text = value => typeof value === 'string' && value.trim().length > 0;
  const id = () => globalThis.crypto.randomUUID();
  const today = () => {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    return ['year','month','day'].map(type => parts.find(part => part.type === type).value).join('-');
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
  const cards = Object.freeze({ nubank: 'Nubank', mercado_pago: 'Mercado Pago' });
  const validCard = value => typeof value === 'string' && Object.hasOwn(cards, value);
  function cardForRule(rule) {
    const canonical = Object.keys(cards).find(value => rule.id === `card:${value}`);
    if (rule.cardId !== undefined && (!validCard(rule.cardId) || canonical && canonical !== rule.cardId)) fail('Cartão inválido.');
    return rule.cardId ?? canonical;
  }
  const sumCents = amounts => {
    const total = amounts.reduce((sum, amount) => sum + BigInt(cents(amount)), 0n);
    if (total > BigInt(Number.MAX_SAFE_INTEGER) || total < BigInt(Number.MIN_SAFE_INTEGER)) fail('Valor fora do limite permitido.');
    return Number(total);
  };
  const empty = () => ({ version: 1, openingBalance: null, adjustments: [], monthlyPlans: [], recurringBills: [], bills: [], creditPurchases: [] });

  function ensure(data) {
    if (!object(data)) fail('Documento inválido.');
    if (data.finance === undefined) data.finance = empty();
    if (!object(data.finance) || data.finance.version !== 1 || !['adjustments', 'monthlyPlans', 'recurringBills', 'bills'].every(key => Array.isArray(data.finance[key]))) fail('Dados financeiros inválidos.');
    if (data.finance.creditPurchases === undefined) data.finance.creditPurchases = [];
    if (!Array.isArray(data.finance.creditPurchases)) fail('Compras no crédito inválidas.');
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
    if (input.cardId !== undefined && !validCard(input.cardId)) fail('Cartão inválido.');
    return { description: input.description.trim(), category: input.category.trim(), fixed: input.fixed, expectedAmount, dueDay: day(input.dueDay), startMonth, endMonth, active: input.active, ...(input.cardId === undefined ? {} : { cardId: input.cardId }) };
  }
  const recurringActive = (rule, value) => rule.active && value >= rule.startMonth && (!rule.endMonth || value <= rule.endMonth);
  function creditObligations(finance) {
    const rules = new Map(finance.recurringBills.map(rule => [cardForRule(rule), rule])), obligations = new Map();
    for (const purchase of finance.creditPurchases || []) {
      const rule = rules.get(purchase.cardId);
      if (!rule) fail('Recorrência do cartão não encontrada.');
      for (const part of purchase.installments) {
        const value = part.date.slice(0, 7), billId = `recurring:${rule.id}:${value}`;
        if (!obligations.has(billId)) obligations.set(billId, { rule, month: value, charges: 0n });
        obligations.get(billId).charges += BigInt(cents(part.amount));
      }
    }
    // Keep vacated months in the expectations so later saves cannot restore old debt.
    for (const edit of finance.creditEdits || []) {
      const purchase = finance.creditPurchases.find(row => row.id === edit.purchaseId), rule = rules.get(purchase.cardId);
      for (const part of [...edit.before.installments, ...edit.after.installments]) {
        const value = part.date.slice(0, 7), billId = `recurring:${rule.id}:${value}`;
        if (!obligations.has(billId)) obligations.set(billId, { rule, month: value, charges: 0n });
      }
    }
    for (const obligation of obligations.values()) {
      const base = recurringActive(obligation.rule, obligation.month) ? obligation.rule.expectedAmount ?? 0 : 0;
      const total = obligation.charges + BigInt(cents(base));
      if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
        // Closed invoices retain their historical estimate independently of later bases.
        const closed = finance.bills.some(bill => bill.id === `recurring:${obligation.rule.id}:${obligation.month}` && bill.status !== 'pending');
        if (!closed) fail('Valor fora do limite permitido.');
      }
      obligation.expectedAmount = Number(total) / 100;
    }
    return obligations;
  }
  function saveRecurring(data, input) {
    const normalized = normalizeRecurring(input), finance = ensure(data);
    if (input.id !== undefined && !text(input.id)) fail('Identificador inválido.');
    const existing = input.id === undefined ? null : finance.recurringBills.find(row => row.id === input.id);
    if (input.id !== undefined && !existing) fail('Recorrência não encontrada.');
    if (existing?.cardId !== undefined && input.cardId === undefined) normalized.cardId = existing.cardId;
    const candidate = { ...(existing || {}), ...normalized };
    const cardId = cardForRule(candidate);
    if (existing && cardForRule(existing) !== cardId) fail('Não é permitido alterar o cartão da recorrência.');
    if (cardId && finance.recurringBills.some(row => row.id !== existing?.id && cardForRule(row) === cardId)) fail('Este cartão já possui uma recorrência.');
    if (existing) {
      if (cardId) {
        // Preflight every generated pending month so future installment invoices
        // follow base/activity edits atomically, while closed snapshots remain intact.
        const staged = { ...data, finance: { ...finance, recurringBills: finance.recurringBills.map(row => row.id === existing.id ? candidate : row), bills: finance.bills.map(bill => ({ ...bill })) } };
        const months = new Set(finance.bills.filter(bill => bill.source === 'recurring' && bill.sourceId === existing.id && bill.status === 'pending').map(bill => bill.month));
        for (const obligation of creditObligations(staged.finance).values()) if (obligation.rule.id === existing.id) months.add(obligation.month);
        for (const value of months) syncMonth(staged, value);
        Object.assign(existing, normalized);
        finance.bills = staged.finance.bills;
      } else Object.assign(existing, normalized);
      return existing;
    }
    const rule = { id: id(), ...normalized };
    finance.recurringBills.push(rule);
    return rule;
  }
  function ensureCreditCards(data, value) {
    month(value);
    const finance = ensure(data), found = new Set();
    for (const rule of finance.recurringBills) {
      const cardId = cardForRule(rule);
      if (cardId && found.has(cardId)) fail('Este cartão já possui uma recorrência.');
      if (cardId) found.add(cardId);
    }
    for (const cardId of Object.keys(cards)) if (!found.has(cardId)) finance.recurringBills.push({
      id: `card:${cardId}`, cardId, description: `Cartão de crédito · ${cards[cardId]}`, category: 'Cartão de crédito',
      fixed: false, expectedAmount: 0, dueDay: 10, startMonth: value, endMonth: null, active: true
    });
    return finance.recurringBills.filter(rule => cardForRule(rule));
  }
  function normalizeCreditPurchase(input, consecutive = false) {
    if (!object(input) || !validCard(input.cardId) || !text(input.description) || !text(input.category)) fail('Informe cartão, descrição e categoria da compra.');
    const purchaseDate = date(input.purchaseDate);
    if (!validMoney(input.amount) || input.amount <= 0) fail('Informe um valor positivo em centavos.');
    if (!Array.isArray(input.items) || input.items.some(item => !object(item) || !text(item.name) || typeof item.qty !== 'number' || !Number.isFinite(item.qty) || item.qty <= 0 || !validMoney(item.unit) || item.unit < 0)) fail('Itens da compra inválidos.');
    const count = input.installments?.length;
    if (!Array.isArray(input.installments) || count < 1 || count > 120) fail('Informe de 1 a 120 parcelas.');
    let previousMonth;
    const installments = input.installments.map((part, index) => {
      if (!object(part) || !validDate(part.date) || !part.date.endsWith('-01') || !validMoney(part.amount) || part.amount <= 0 || part.installmentNumber !== index + 1 || part.installmentCount !== count) fail('Parcela inválida.');
      const partMonth = part.date.slice(0, 7), serial = Number(partMonth.slice(0, 4)) * 12 + Number(partMonth.slice(5, 7));
      if (index === 0 && partMonth < purchaseDate.slice(0, 7) || index > 0 && (serial <= previousMonth || consecutive && serial !== previousMonth + 1)) fail('Escolha meses em ordem, sem repetir o mês de uma parcela.');
      previousMonth = serial;
      return { date: part.date, amount: part.amount, installmentNumber: index + 1, installmentCount: count };
    });
    if (sumCents(installments.map(part => part.amount)) !== cents(input.amount)) fail('A soma das parcelas deve corresponder ao total da compra.');
    return { cardId: input.cardId, description: input.description.trim(), category: input.category.trim(), purchaseDate, amount: input.amount,
      items: input.items.map(item => ({ name: item.name.trim(), qty: item.qty, unit: item.unit })), installments };
  }
  function closedCreditInvoice(finance, cardId, value) {
    const rule = finance.recurringBills.find(row => cardForRule(row) === cardId);
    return finance.bills.some(bill => bill.source === 'recurring' && bill.sourceId === (rule?.id || `card:${cardId}`) && bill.month === value && bill.status !== 'pending');
  }
  function recordCreditPurchase(data, input) {
    const normalized = normalizeCreditPurchase(input, true);
    if (!validateFinance(data)) fail('Dados financeiros inválidos.');
    const staged = { ...data, finance: structuredClone(data.finance || empty()) };
    ensureCreditCards(staged, normalized.installments[0].date.slice(0, 7));
    for (const part of normalized.installments) if (closedCreditInvoice(staged.finance, normalized.cardId, part.date.slice(0, 7))) fail('A fatura já foi paga ou cancelada. Escolha outro mês inicial.');
    const purchase = { id: id(), ...normalized };
    staged.finance.creditPurchases.push(purchase);
    for (const part of normalized.installments) syncMonth(staged, part.date.slice(0, 7));
    if (!validateFinance(staged)) fail('Dados financeiros inválidos.');
    data.finance = staged.finance;
    return purchase;
  }
  const creditSnapshot = purchase => ({ amount: purchase.amount, installments: structuredClone(purchase.installments) });
  function editableCreditChanges(finance, purchase, next, onDate) {
    if (purchase.installments.length !== next.installments.length) return false;
    let changed = false;
    for (let index = 0; index < purchase.installments.length; index++) {
      const oldPart = purchase.installments[index], newPart = next.installments[index];
      if (same(oldPart, newPart)) continue;
      changed = true;
      if (oldPart.date.slice(0, 7) < onDate.slice(0, 7) || newPart.date.slice(0, 7) < onDate.slice(0, 7) || closedCreditInvoice(finance, purchase.cardId, oldPart.date.slice(0, 7)) || closedCreditInvoice(finance, purchase.cardId, newPart.date.slice(0, 7))) return false;
    }
    return changed;
  }
  function canEditCreditInstallment(data, purchaseId, index) {
    const finance = data.finance, purchase = finance?.creditPurchases?.find(row => row.id === purchaseId), part = purchase?.installments[index];
    return !!part && part.date.slice(0, 7) >= today().slice(0, 7) && !closedCreditInvoice(finance, purchase.cardId, part.date.slice(0, 7));
  }
  function editCreditInstallments(data, purchaseId, input) {
    if (!validateFinance(data)) fail('Dados financeiros inválidos.');
    const purchase = data.finance?.creditPurchases?.find(row => row.id === purchaseId);
    if (!purchase || !object(input) || !text(input.reason) || input.reason.trim().length > 500 || !Array.isArray(input.installments)) fail('Informe a compra, as parcelas e o motivo da alteração.');
    const next = normalizeCreditPurchase({ ...purchase, installments: input.installments, amount: sumCents(input.installments.map(part => part?.amount)) / 100 }), onDate = today();
    if (!editableCreditChanges(data.finance, purchase, next, onDate)) fail('Altere somente parcelas em aberto do mês atual ou dos próximos meses. Faturas pagas, canceladas e meses passados são preservados.');
    const staged = { ...data, finance: structuredClone(data.finance) }, index = staged.finance.creditPurchases.findIndex(row => row.id === purchaseId);
    staged.finance.creditPurchases[index] = { id: purchase.id, ...next };
    staged.finance.creditEdits ||= [];
    staged.finance.creditEdits.push({ id: id(), purchaseId, date: onDate, createdAt: new Date().toISOString(), reason: input.reason.trim(), before: creditSnapshot(purchase), after: creditSnapshot(next) });
    for (const value of new Set([...purchase.installments, ...next.installments].map(part => part.date.slice(0, 7)))) syncMonth(staged, value);
    if (!validateFinanceChange(data, staged)) fail('Não foi possível atualizar as parcelas. Confira as faturas e os valores.');
    data.finance = staged.finance;
    return staged.finance.creditPurchases[index];
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
      if (finance.bills.some(bill => bill.id === `recurring:${rule.id}:${value}` && bill.status !== 'pending')) continue;
      const active = recurringActive(rule, value), cardId = cardForRule(rule);
      const charges = cardId ? finance.creditPurchases.filter(purchase => purchase.cardId === cardId).flatMap(purchase => purchase.installments.filter(part => part.date.slice(0, 7) === value)) : [];
      if (!active && !charges.length) continue;
      const expectedAmount = cardId ? sumCents([active ? rule.expectedAmount ?? 0 : 0, ...charges.map(part => part.amount)]) / 100 : rule.expectedAmount;
      wanted.set(`recurring:${rule.id}:${value}`, { source: 'recurring', sourceId: rule.id, description: rule.description, category: rule.category, expectedAmount, dueDate: dueDate(value, rule.dueDay) });
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
      if (finance.creditPurchases !== undefined && !Array.isArray(finance.creditPurchases)) return false;
      const purchases = finance.creditPurchases || [];
      if (!unique(purchases, 'id')) return false;
      const creditEdits = finance.creditEdits || [];
      if (!Array.isArray(creditEdits) || !unique(creditEdits, 'id')) return false;
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
      const cardRules = new Map();
      for (const rule of finance.recurringBills) {
        if (!same(rule, { id: rule.id, ...normalizeRecurring(rule) })) return false;
        const cardId = cardForRule(rule);
        if (cardId && cardRules.has(cardId)) return false;
        if (cardId) cardRules.set(cardId, rule);
      }
      for (const purchase of purchases) if (!same(purchase, { id: purchase.id, ...normalizeCreditPurchase(purchase) }) || !cardRules.has(purchase.cardId)) return false;
      const editedSnapshots = new Map();
      for (const edit of creditEdits) {
        const purchase = purchases.find(row => row.id === edit.purchaseId);
        if (!purchase || !validDate(edit.date) || !text(edit.reason) || edit.reason.length > 500 || typeof edit.createdAt !== 'string' || !Number.isFinite(Date.parse(edit.createdAt))) return false;
        for (const snapshot of [edit.before, edit.after]) {
          if (!object(snapshot) || !same(snapshot, creditSnapshot(normalizeCreditPurchase({ ...purchase, ...snapshot })))) return false;
        }
        const previous = editedSnapshots.get(purchase.id);
        if (previous && (!same(previous.snapshot, edit.before) || previous.date > edit.date)) return false;
        if (!editableCreditChanges({ recurringBills: finance.recurringBills, bills: [] }, { ...purchase, ...edit.before }, edit.after, edit.date)) return false;
        editedSnapshots.set(purchase.id, { snapshot: edit.after, date: edit.date });
      }
      for (const [purchaseId, value] of editedSnapshots) if (!same(value.snapshot, creditSnapshot(purchases.find(row => row.id === purchaseId)))) return false;
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
      for (const [billId, obligation] of creditObligations(finance)) {
        const bill = billsById.get(billId);
        if (!bill && obligation.charges === 0n && !recurringActive(obligation.rule, obligation.month)) continue;
        if (!bill || bill.source !== 'recurring' || bill.sourceId !== obligation.rule.id || bill.month !== obligation.month) return false;
        if (bill.status === 'pending' && bill.expectedAmount !== obligation.expectedAmount) return false;
      }
      return true;
    } catch { return false; }
  }
  function validateFinanceChange(previous, next) {
    if (!validateFinance(previous) || !validateFinance(next)) return false;
    const before = previous.finance || empty(), after = next.finance;
    if (!after) return before.openingBalance === null && before.adjustments.length === 0 && before.bills.length === 0 && !(before.creditPurchases || []).length;
    if (before.openingBalance !== null && !same(before.openingBalance, after.openingBalance)) return false;
    if (after.adjustments.length < before.adjustments.length || !before.adjustments.every((row, index) => same(row, after.adjustments[index]))) return false;
    const oldPurchases = before.creditPurchases || [], newPurchases = after.creditPurchases || [];
    const oldEdits = before.creditEdits || [], edits = after.creditEdits || [];
    if (edits.length < oldEdits.length || !oldEdits.every((row, index) => same(row, edits[index])) || newPurchases.length < oldPurchases.length) return false;
    const expectedPurchases = new Map(oldPurchases.map(row => [row.id, row]));
    for (const edit of edits.slice(oldEdits.length)) {
      const purchase = expectedPurchases.get(edit.purchaseId);
      if (!purchase || edit.date !== today() || !same(creditSnapshot(purchase), edit.before) || !editableCreditChanges(before, purchase, edit.after, edit.date) || !editableCreditChanges(after, purchase, edit.after, edit.date)) return false;
      expectedPurchases.set(purchase.id, { ...purchase, ...edit.after });
    }
    if (!oldPurchases.every((row, index) => same(expectedPurchases.get(row.id), newPurchases[index]))) return false;
    for (const rule of before.recurringBills) {
      const nextRule = after.recurringBills.find(row => row.id === rule.id), cardId = cardForRule(rule);
      if (nextRule && (cardForRule(nextRule) !== cardId || rule.cardId !== undefined && nextRule.cardId !== rule.cardId)) return false;
      if (!nextRule && cardId && oldPurchases.some(purchase => purchase.cardId === cardId)) return false;
    }
    for (const purchase of newPurchases.slice(oldPurchases.length)) for (const part of purchase.installments) {
      if (closedCreditInvoice(before, purchase.cardId, part.date.slice(0, 7))) return false;
    }
    try {
      const previousBills = new Map(before.bills.map(bill => [bill.id, bill])), nextBills = new Map(after.bills.map(bill => [bill.id, bill]));
      const nextObligations = creditObligations(after);
      for (const [billId, obligation] of nextObligations) {
        const bill = nextBills.get(billId), oldBill = previousBills.get(billId);
        if (!bill && obligation.charges === 0n && !recurringActive(obligation.rule, obligation.month)) continue;
        if ((!oldBill || oldBill.status === 'pending') && bill.expectedAmount !== obligation.expectedAmount) return false;
      }
      for (const [billId, obligation] of creditObligations(before)) {
        if (nextObligations.has(billId) || previousBills.get(billId)?.status !== 'pending') continue;
        const rule = after.recurringBills.find(row => row.id === obligation.rule.id), bill = nextBills.get(billId);
        if (!rule) return false;
        const active = recurringActive(rule, obligation.month), base = active ? rule.expectedAmount ?? 0 : 0;
        if (bill ? bill.expectedAmount !== base : active) return false;
      }
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

  globalThis.FinanceCore = Object.freeze({ ensure, ensureCreditCards, recordCreditPurchase, editCreditInstallments, canEditCreditInstallment, syncMonth, setMonthPlan, saveRecurring, createBill, cancelBill, payBill, currentBalance, setCurrentBalance, monthlySummary, validateFinance, validateFinanceChange });
})();
