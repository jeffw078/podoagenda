const CARD_IDS = new Set(['nubank', 'mercado_pago']);
const MONTH_RE = /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const cents = value => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError('Valor inválido.');
  const [coefficient, exponent = '0'] = Math.abs(value).toString().toLowerCase().split('e');
  const [whole, fraction = ''] = coefficient.split('.');
  const digits = BigInt(whole + fraction), shift = 2 + Number(exponent) - fraction.length;
  let rounded;
  if (shift >= 0) rounded = digits * 10n ** BigInt(shift);
  else { const divisor = 10n ** BigInt(-shift); rounded = digits / divisor + (digits % divisor * 2n >= divisor ? 1n : 0n); }
  const result = Math.sign(value) * Number(rounded);
  if (!Number.isSafeInteger(result)) throw new TypeError('Valor fora do limite permitido.');
  return result;
};
const money = value => cents(value) / 100;
const validAmount = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && (() => { try { return money(value) === value; } catch { return false; } })();
const add = (...values) => values.reduce((sum, value) => sum + cents(value), 0);
const monthOf = date => typeof date === 'string' && DATE_RE.test(date) ? date.slice(0, 7) : '';

function validateCardLimits(value) {
  if (!Array.isArray(value)) return false;
  const seen = new Set();
  return value.every(row => {
    if (!isRecord(row) || typeof row.month !== 'string' || !MONTH_RE.test(row.month) || !CARD_IDS.has(row.cardId) || !validAmount(row.amount)) return false;
    const key = `${row.month}:${row.cardId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function createFinanceInsights(FinanceCore) {
  if (!FinanceCore || typeof FinanceCore.monthlySummary !== 'function') throw new TypeError('FinanceCore inválido.');

  function cardCommitments(data, value) {
    const finance = data.finance || {}, result = new Map();
    for (const cardId of CARD_IDS) result.set(cardId, 0);
    for (const rule of finance.recurringBills || []) {
      const cardId = rule.cardId || (rule.id === 'card:nubank' ? 'nubank' : rule.id === 'card:mercado_pago' ? 'mercado_pago' : null);
      if (CARD_IDS.has(cardId) && rule.active && value >= rule.startMonth && (!rule.endMonth || value <= rule.endMonth)) {
        result.set(cardId, add(result.get(cardId) / 100, rule.expectedAmount ?? 0));
      }
    }
    for (const purchase of finance.creditPurchases || []) for (const part of purchase.installments || []) {
      if (monthOf(part.date) === value && CARD_IDS.has(purchase.cardId)) result.set(purchase.cardId, add(result.get(purchase.cardId) / 100, part.amount));
    }
    return result;
  }

  function cardWarnings(data, input = {}) {
    const finance = data?.finance || {}, limits = finance.cardLimits || [];
    if (!validateCardLimits(limits)) throw new TypeError('Limites de cartão inválidos.');
    const additions = new Map();
    if (input.cardId !== undefined) {
      if (!CARD_IDS.has(input.cardId) || !Array.isArray(input.installments)) throw new TypeError('Compra projetada inválida.');
      for (const part of input.installments) {
        const value = monthOf(part?.date);
        if (!value || !validAmount(part.amount)) throw new TypeError('Parcela projetada inválida.');
        const key = `${value}:${input.cardId}`;
        additions.set(key, add((additions.get(key) || 0) / 100, part.amount));
      }
    }
    return limits.flatMap(limit => {
      const committed = cardCommitments(data, limit.month).get(limit.cardId) || 0;
      const projected = committed + (additions.get(`${limit.month}:${limit.cardId}`) || 0);
      return projected > cents(limit.amount) ? [{ month: limit.month, cardId: limit.cardId, limit: limit.amount, committed: committed / 100, projected: projected / 100, excess: (projected - cents(limit.amount)) / 100 }] : [];
    });
  }

  function setCardLimit(data, value, cardId, amount) {
    if (!isRecord(data) || typeof value !== 'string' || !MONTH_RE.test(value) || !CARD_IDS.has(cardId) || typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) throw new TypeError('Limite de cartão inválido.');
    data.finance ||= { version: 1, openingBalance: null, adjustments: [], monthlyPlans: [], recurringBills: [], bills: [], creditPurchases: [] };
    if (!isRecord(data.finance)) throw new TypeError('Dados financeiros inválidos.');
    const limits = data.finance.cardLimits || [];
    if (!validateCardLimits(limits)) throw new TypeError('Limites de cartão inválidos.');
    data.finance.cardLimits = limits;
    const normalized = { month: value, cardId, amount: money(amount) };
    const index = limits.findIndex(row => row.month === value && row.cardId === cardId);
    if (index < 0) limits.push(normalized); else limits[index] = normalized;
    return normalized;
  }

  function overview(data, value, asOf) {
    if (typeof value !== 'string' || !MONTH_RE.test(value) || typeof asOf !== 'string' || !DATE_RE.test(asOf)) throw new TypeError('Mês ou data inválidos.');
    const actualData = data && typeof structuredClone === 'function' ? structuredClone(data) : JSON.parse(JSON.stringify(data || {}));
    const summary = FinanceCore.monthlySummary(actualData, value, asOf);
    const finance = data?.finance || {}, plan = (finance.monthlyPlans || []).find(row => row.month === value);
    const rows = data?.transactions || [];
    const projectedIncome = Math.max(rows.filter(row=>row.type==='income'&&monthOf(row.date)===value).reduce((sum,row)=>sum+cents(row.amount),0)/100, plan?.expectedIncome || 0);
    const bills = (finance.bills || []).filter(bill => bill.month === value && bill.status !== 'cancelled');
    let outflowCents = 0, unknown = 0;
    const categories = new Map();
    const addCategory=(category,amount)=>categories.set(category||'Outros',(categories.get(category||'Outros')||0)+cents(amount));
    const cardBill=bill=>bill?.source==='recurring'&&(bill.sourceId==='card:nubank'||bill.sourceId==='card:mercado_pago'||(finance.recurringBills||[]).some(rule=>rule.id===bill.sourceId&&CARD_IDS.has(rule.cardId)));
    for (const row of rows) {
      if(row.type!=='expense'||monthOf(row.date)!==value)continue;
      outflowCents+=cents(row.amount);
      const bill=(finance.bills||[]).find(bill=>bill.id===row.billId);
      if(row.financeKind==='reserve'||cardBill(bill))continue;
      addCategory(row.category||bill?.category,row.amount);
    }
    for (const purchase of finance.creditPurchases || []) for (const part of purchase.installments || []) {
      if(monthOf(part.date)===value)addCategory(purchase.category,part.amount);
    }
    for (const bill of bills) if(bill.status==='pending') {
      if(bill.expectedAmount===null)unknown++;else outflowCents+=cents(bill.expectedAmount);
    }
    const through = value < asOf.slice(0, 7) ? value : asOf.slice(0, 7);
    let saved = 0, target = 0;
    for (const row of data?.transactions || []) if (row.type === 'expense' && row.financeKind === 'reserve' && row.date <= asOf && monthOf(row.date) <= through) saved = add(saved / 100, row.amount);
    for (const monthlyPlan of finance.monthlyPlans || []) if (monthlyPlan.month <= through) {
      const amount = monthlyPlan.reserveMode === 'percentage'
        ? Number((BigInt(cents(monthlyPlan.expectedIncome)) * BigInt(cents(monthlyPlan.reserveValue)) + 5000n) / 10000n) / 100
        : monthlyPlan.reserveValue;
      target = add(target / 100, amount);
    }
    const gapCents = cents(projectedIncome) - outflowCents;
    return {
      month: value, asOf, summary,
      forecast: { income: projectedIncome, outflows: outflowCents / 100, gap: gapCents / 100, shortfall: Math.max(0, -gapCents) / 100, unknown },
      categories: [...categories].map(([category, total]) => ({ category, amount: total / 100 })),
      reserve: { throughMonth: through, saved: saved / 100, target: target / 100, difference: (saved - target) / 100, percentage: target ? Math.min(100, Math.round(saved * 10000 / target) / 100) : null }
    };
  }

  return Object.freeze({ overview, validateCardLimits, setCardLimit, cardWarnings });
}

export { createFinanceInsights, validateCardLimits };
