import FinanceCore from './finance-browser.js';
import {installActionEvents} from './ui-actions.js';
/* Financial views. Classic script: uses FinanceCore and the application's helpers. */
'use strict';
let financeSettingsSelectedMonth = '';
let financeBillsSelectedMonth = '';

function financeMonth(inputId) {
  const value = $(inputId)?.value;
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value || '') ? value : dateToday.slice(0, 7);
}
function financeMonthLabel(month) {
  return new Date(`${month}-01T12:00:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}
function financeDateLabel(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date.split('-').reverse().join('/') : '—';
}
function financeArgument(value) { return esc(JSON.stringify(String(value))); }
function financeInput(label, id, type, value = '', attributes = '') {
  return `<label class="field">${label}<input id="${id}" type="${type}" value="${esc(value)}" ${attributes}></label>`;
}
function financeError(error) { alert(error?.message || 'Não foi possível salvar. Confira os campos.'); }
function financeMutate(action, after) {
  try { action(); } catch (error) { financeError(error); return false; }
  persist();
  closeModal();
  renderAll();
  if (after) after();
  return true;
}
function financeSync(month) {
  const before = JSON.stringify(db.finance);
  FinanceCore.ensureCreditCards(db, month);
  const bills = FinanceCore.syncMonth(db, month);
  if (JSON.stringify(db.finance) !== before) persist();
  return bills;
}
function financeAmount(id, optional = false) {
  const raw = $(id).value.trim();
  if (optional && !raw) return null;
  const value = Number(raw.replace(',', '.'));
  if (!raw || !Number.isFinite(value) || value < 0) throw Error('Informe um valor válido, maior ou igual a zero.');
  return value;
}
function financeStatus(bill) {
  const labels = { pending: 'Pendente', paid: 'Paga', cancelled: 'Cancelada' };
  const late = bill.status === 'pending' && bill.dueDate < dateToday;
  return `<span class="pill ${late ? 'red' : bill.status === 'paid' ? 'green' : 'gray'}">${late ? 'Vencida · pendente' : labels[bill.status] || 'Pendente'}</span>`;
}
function financeBillRows(bills, compact = false) {
  if (!bills.length) return '<p class="empty">Nenhuma conta neste mês. Cadastre uma conta ou configure suas recorrências.</p>';
  return [...bills].sort((a, b) => (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1) || a.dueDate.localeCompare(b.dueDate)).map(bill => `<article class="finance-bill">
    <div class="finance-bill-main"><strong>${esc(bill.description)}</strong><span class="muted tiny">${esc(bill.category)} · Vence ${financeDateLabel(bill.dueDate)}${bill.source === 'recurring' ? ' · Recorrente' : bill.source === 'reserve' ? ' · Reserva mensal' : ''}</span>${financeStatus(bill)}</div>
    <div class="finance-bill-values"><span class="tiny muted">Previsto</span><strong>${bill.expectedAmount == null ? 'Sem previsão' : esc(money(bill.expectedAmount))}</strong>${bill.status === 'paid' ? `<span class="tiny muted">Pago em ${financeDateLabel(bill.paidDate)}</span><strong class="positive">${esc(money(bill.paidAmount))}</strong>` : ''}</div>
    ${bill.status === 'pending' ? `<div class="actions finance-bill-actions"><button type="button" class="btn small" data-onclick="financeOpenPayment(${financeArgument(bill.id)})" aria-label="Pagar ${esc(bill.description)}">Pagar</button>${compact ? '' : `<button type="button" class="btn outline small" data-onclick="financeCancelBill(${financeArgument(bill.id)})" aria-label="Cancelar ${esc(bill.description)}">Cancelar</button>`}</div>` : ''}
  </article>`).join('');
}
function financeKpi(label, value, hint = '', extra = '') {
  return `<div class="kpi ${extra}"><div class="lbl">${label}</div><div class="num ${Number(value) < 0 ? 'negative' : ''}">${esc(money(value))}</div>${hint ? `<p class="footer-note">${hint}</p>` : ''}</div>`;
}
function financeCardName(id){return {nubank:'Nubank',mercado_pago:'Mercado Pago'}[id]||'Cartão de crédito'}
function financeCreditPurchasesHtml(month){
 const purchases=(FinanceCore.ensure(db).creditPurchases||[]).filter(purchase=>purchase.installments.some(part=>part.date.slice(0,7)===month));
 return '<section class="card"><h3>Compras no crédito</h3><p class="footer-note">As parcelas são somadas à conta mensal do cartão. Registre o pagamento da fatura em Contas.</p>'+(purchases.length?purchases.map(purchase=>{const parts=purchase.installments.filter(part=>part.date.slice(0,7)===month);return '<div class="finance-transaction"><div><strong>'+esc(purchase.description)+'</strong><small>'+esc(financeCardName(purchase.cardId))+' · Compra em '+financeDateLabel(purchase.purchaseDate)+'</small><small>'+parts.map(part=>'Parcela '+part.installmentNumber+'/'+part.installmentCount+' · '+esc(money(part.amount))).join(' · ')+' · Total '+esc(money(purchase.amount))+'</small>'+'</div></div>'}).join(''):'<p class="empty">Nenhuma compra no crédito para esta fatura.</p>')+'</section>';
}
function renderPersonalFinance(targetId = 'personalFinanceContent', monthId = 'personalMonth') {
  const target = $(targetId);
  if (!target) return;
  const month = financeMonth(monthId);
  const bills = financeSync(month);
  const summary = FinanceCore.monthlySummary(db, month, dateToday);
  const plan = db.finance.monthlyPlans.find(item => item.month === month);
  const unknown = Number(summary.pendingUnknown || 0);
  const transactions = (db.transactions || []).filter(t => t.date?.slice(0, 7) === month).sort((a, b) => b.date.localeCompare(a.date));
  target.innerHTML = `<div class="finance-kpis">
    ${financeKpi('Disponível hoje', summary.balance, 'Saldo cadastrado, atualizado pelos lançamentos até hoje.', 'finance-kpi-featured')}
    ${financeKpi('Contas pendentes', summary.pending, unknown ? `+ ${unknown} conta(s) sem previsão de valor` : 'Valores previstos para este mês')}
    ${financeKpi('Gastos do mês', summary.spending, 'Compras e gastos de consumo')}
    ${financeKpi('Reservado no mês', summary.reserved, `Meta: ${esc(money(summary.reserveExpected))}`)}
  </div>
  <div class="actions finance-quick-actions"><button type="button" class="btn" data-onclick="openIncome()">+ Entrada</button><button type="button" class="btn secondary" data-onclick="openFinanceExpenses('bills')">Contas e gastos</button><button type="button" class="btn outline" data-onclick="financeOpenBalance()">Conferir saldo</button></div>
  <div class="finance-columns"><section class="card"><div class="finance-heading"><h3>Visão de ${esc(financeMonthLabel(month))}</h3><button class="btn outline small" data-onclick="financeOpenPlan(${financeArgument(month)})">Planejar mês</button></div>
    <dl class="finance-summary"><div><dt>Renda mensal prevista</dt><dd>${plan ? esc(money(plan.expectedIncome)) : 'Não informada'}</dd></div><div><dt>Entradas lançadas</dt><dd>${esc(money(summary.income))}</dd></div><div><dt>Contas pagas</dt><dd>${esc(money(summary.billsPaid))}</dd></div><div><dt>Disponível após as contas previstas</dt><dd>${esc(money(summary.freeAfterBills))}</dd></div></dl>${unknown ? '<p class="notice warn">Existem contas sem valor previsto. O disponível após as contas ainda pode mudar.</p>' : ''}
    ${!db.finance.openingBalance ? '<button type="button" class="btn secondary full" data-onclick="financeOpenBalance()">Cadastrar meu saldo atual</button>' : ''}
  </section><section class="card"><div class="finance-heading"><h3>Contas do mês</h3><button class="btn outline small" data-onclick="openFinanceExpenses('bills')">Ver / adicionar</button></div>${financeBillRows(bills, true)}</section></div>${financeCreditPurchasesHtml(month)}
  <section class="card"><h3>Movimentações do mês</h3>${transactions.length ? transactions.map(t => `<div class="finance-transaction"><div><strong>${esc(t.description || t.category || 'Lançamento')}</strong><small>${financeDateLabel(t.date)} · ${esc(t.financeKind === 'reserve' ? 'Reserva' : t.financeKind === 'bill' ? 'Conta paga' : t.category || 'Movimentação')}</small></div><strong class="${t.type === 'income' ? 'positive' : 'negative'}">${t.type === 'income' ? '+' : '−'} ${esc(money(t.amount))}</strong></div>`).join('') : '<p class="empty">Sem movimentações neste mês.</p>'}</section>`;
}

function openFinanceExpenses(tab = 'bills', preserveMonth = false) {
  const spending = tab === 'spending' || tab === 'gastos';
  const month = (preserveMonth && financeBillsSelectedMonth) || financeMonth(profile === 'personal' ? 'personalMonth' : 'financeMonth');
  financeBillsSelectedMonth = month;
  const tabs = `<div class="tabs finance-tabs" aria-label="Tipo de despesa"><button type="button" class="${spending ? '' : 'selected'}" aria-pressed="${!spending}" data-onclick="openFinanceExpenses('bills',true)">Contas</button><button type="button" class="${spending ? 'selected' : ''}" aria-pressed="${spending}" data-onclick="openFinanceExpenses('spending',true)">Gastos</button></div>`;
  if (spending) {
    modal('Contas e gastos', tabs + '<p class="footer-note">Registre compras e seus itens. No crédito, escolha o cartão e o mês de cada fatura.</p>' + renderSpendingForm()+financeCreditPurchasesHtml(month));
    showSpendingFields();
    return;
  }
  const bills = financeSync(month);
  modal('Contas e gastos', tabs + `<div class="finance-heading">${financeInput('Mês das contas', 'financeBillsMonth', 'month', month, 'required data-onchange="financeChangeBillsMonth()"')}<button type="button" class="btn small" data-onclick="financeOpenBill()">+ Conta avulsa</button></div><p class="footer-note">Cadastre vencimentos aqui. Ao pagar, informe o valor real; a previsão fica preservada.</p><div class="card">${financeBillRows(bills)}</div><button type="button" class="btn outline full" data-onclick="financeOpenRecurring()">+ Conta recorrente</button>`);
}
function financeChangeBillsMonth() { financeBillsSelectedMonth = financeMonth('financeBillsMonth'); openFinanceExpenses('bills', true); }
function financeCategories(selected = '') {
  return [...new Set([...expenseCategories, 'Reserva', selected].filter(Boolean))].map(category => `<option value="${esc(category)}" ${category === selected ? 'selected' : ''}>${esc(category)}</option>`).join('');
}
function financeOpenBill() {
  const month = financeBillsSelectedMonth || financeMonth(profile === 'personal' ? 'personalMonth' : 'financeMonth');
  modal('Nova conta', `<form class="fields" data-onsubmit="event.preventDefault();financeSaveBill()">${financeInput('Descrição', 'financeBillDescription', 'text', '', 'required maxlength="180"')}
    <div class="fields two">${financeInput('Vencimento', 'financeBillDue', 'date', `${month}-01`, 'required')}${financeInput('Valor previsto (R$), se conhecido', 'financeBillAmount', 'number', '', 'min="0" step="0.01" placeholder="Sem previsão"')}</div>
    <label class="field">Categoria<select id="financeBillCategory">${financeCategories('Outros')}</select></label><p class="footer-note">Deixe o valor vazio se ainda não souber quanto virá. Informe o valor efetivo na hora de pagar.</p><button type="submit" class="btn full">Cadastrar conta</button></form>`);
}
function financeSaveBill() {
  financeMutate(() => {
    const dueDate = $('financeBillDue').value;
    FinanceCore.createBill(db, { description: $('financeBillDescription').value.trim(), category: $('financeBillCategory').value, dueDate, month: dueDate.slice(0, 7), expectedAmount: financeAmount('financeBillAmount', true) });
    financeBillsSelectedMonth = dueDate.slice(0, 7);
  }, () => openFinanceExpenses('bills', true));
}
function financeOpenPayment(id) {
  const bill = FinanceCore.ensure(db).bills.find(item => item.id === id);
  if (!bill || bill.status !== 'pending') return financeError(Error('Esta conta não está pendente.'));
  modal('Pagar conta', `<form class="fields" data-onsubmit="event.preventDefault();financeSavePayment(${financeArgument(id)})"><div class="notice"><strong>${esc(bill.description)}</strong><br>Previsto: ${bill.expectedAmount == null ? 'Sem previsão' : esc(money(bill.expectedAmount))} · Vencimento: ${financeDateLabel(bill.dueDate)}</div>
    ${financeInput('Valor pago (R$)', 'financePayAmount', 'number', bill.expectedAmount ?? '', 'required min="0.01" step="0.01"')}${financeInput('Data do pagamento', 'financePayDate', 'date', dateToday, 'required')}
    <label class="field">Forma de pagamento<select id="financePayMethod" required><option value="">Selecione</option><option value="pix">Pix</option><option value="debit">Débito</option><option value="cash">Dinheiro</option><option value="transfer">Transferência</option><option value="other">Outra</option></select></label><p class="footer-note">O pagamento sai do saldo disponível e preserva o valor previsto. Para compras no crédito, use a guia Gastos e selecione o cartão.</p><button type="submit" class="btn full">Confirmar pagamento</button></form>`);
}
function financeSavePayment(id) {
  financeMutate(() => {
    const method = $('financePayMethod').value;
    if (!['pix','debit','cash','transfer','other'].includes(method)) throw Error('Selecione uma forma de pagamento com saldo. Para crédito, use Gastos e escolha o cartão.');
    FinanceCore.payBill(db, id, { amount: financeAmount('financePayAmount'), date: $('financePayDate').value, method });
  });
}
function financeCancelBill(id) {
  if (!confirm('Cancelar esta conta pendente? O registro continuará no histórico.')) return;
  financeMutate(() => FinanceCore.cancelBill(db, id), () => openFinanceExpenses('bills', true));
}

function financePlanForm(month, scope = '') {
  const id = name => name + (scope ? '_' + scope : '');
  const plan = FinanceCore.ensure(db).monthlyPlans.find(item => item.month === month) || { expectedIncome: '', reserveMode: 'amount', reserveValue: '', reserveDueDay: 10 };
  return `<form class="fields" data-onsubmit="event.preventDefault();financeSavePlan(${financeArgument(month)},${financeArgument(scope)})"><p class="footer-note">Planejamento de ${esc(financeMonthLabel(month))}. A renda prevista serve para calcular a meta; não cria uma entrada.</p>${financeInput('Renda mensal prevista (R$)', id('financePlanIncome'), 'number', plan.expectedIncome, 'required min="0" step="0.01"')}
    <div class="fields two"><label class="field">Como reservar<select id="${id('financePlanMode')}" data-onchange="financeUpdatePlanMode(${financeArgument(scope)})"><option value="amount" ${plan.reserveMode === 'amount' ? 'selected' : ''}>Valor fixo em reais</option><option value="percentage" ${plan.reserveMode === 'percentage' ? 'selected' : ''}>Percentual da renda prevista</option></select></label><label class="field"><span id="${id('financePlanValueLabel')}">${plan.reserveMode === 'percentage' ? 'Percentual da reserva (%)' : 'Valor da reserva (R$)'}</span><input id="${id('financePlanValue')}" type="number" min="0" ${plan.reserveMode === 'percentage' ? 'max="100"' : ''} step="0.01" value="${esc(plan.reserveValue)}" required></label></div>
    ${financeInput('Dia do vencimento da reserva', id('financePlanDue'), 'number', plan.reserveDueDay, 'required min="1" max="31" step="1"')}<p class="footer-note">A meta gera uma conta de Reserva. Dias que não existem no mês são ajustados para o último dia. Contas pagas preservam o histórico.</p><button type="submit" class="btn full">Salvar planejamento</button></form>`;
}
function financeUpdatePlanMode(scope = '') {
  const id = name => name + (scope ? '_' + scope : '');
  const percentage = $(id('financePlanMode')).value === 'percentage';
  $(id('financePlanValueLabel')).textContent = percentage ? 'Percentual da reserva (%)' : 'Valor da reserva (R$)';
  if (percentage) $(id('financePlanValue')).setAttribute('max', '100');
  else $(id('financePlanValue')).removeAttribute('max');
}
function financeOpenPlan(month) { modal('Planejamento e reserva', financePlanForm(month || financeMonth(profile === 'personal' ? 'personalMonth' : 'financeMonth'))); }
function financeSavePlan(month, scope = '') {
  const id = name => name + (scope ? '_' + scope : '');
  financeMutate(() => FinanceCore.setMonthPlan(db, month, { expectedIncome: financeAmount(id('financePlanIncome')), reserveMode: $(id('financePlanMode')).value, reserveValue: financeAmount(id('financePlanValue')), reserveDueDay: Number($(id('financePlanDue')).value) }));
}
function renderReservePage() {
  const target = $('reserveContent');
  if (!target) return;
  const month = financeMonth('reserveMonth');
  const bills = financeSync(month).filter(item => item.source === 'reserve');
  const summary = FinanceCore.monthlySummary(db, month, dateToday);
  const percent = summary.reserveExpected > 0 ? Math.min(100, Math.max(0, summary.reserved / summary.reserveExpected * 100)) : 0;
  target.innerHTML = `<div class="finance-kpis finance-kpis-three">${financeKpi('Meta do mês', summary.reserveExpected)}${financeKpi('Já reservado', summary.reserved)}${financeKpi('Falta reservar', Math.max(0, summary.reserveExpected - summary.reserved))}</div><section class="card"><h3>Sua reserva em ${esc(financeMonthLabel(month))}</h3><div class="finance-reserve-progress" role="progressbar" aria-label="Progresso da reserva mensal" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(percent)}"><span style="width:${percent}%"></span></div><p class="footer-note">${Math.round(percent)}% da meta reservado. A reserva paga reduz o disponível e fica separada dos gastos de consumo.</p>${financeBillRows(bills)}</section><section class="card"><h3>Planejar reserva mensal</h3>${financePlanForm(month, 'reserve')}</section>`;
}

function financeOpenBalance() {
  const finance = FinanceCore.ensure(db);
  const hasOpening = !!finance.openingBalance;
  modal(hasOpening ? 'Corrigir saldo atual' : 'Cadastrar saldo atual', `<form class="fields" data-onsubmit="event.preventDefault();financeSaveBalance()"><div class="notice">${hasOpening ? 'A correção fica no histórico com o motivo informado. Não é uma receita ou despesa.' : 'Informe seu saldo na data escolhida. Os lançamentos já contabilizados nessa data formam a base inicial.'}</div>${financeInput('Saldo na data (R$)', 'financeBalanceAmount', 'number', hasOpening ? FinanceCore.currentBalance(db, dateToday) : '', 'required step="0.01"')}${financeInput('Data da conferência', 'financeBalanceDate', 'date', dateToday, 'required max="' + dateToday + '"')}${financeInput(hasOpening ? 'Motivo da correção (obrigatório)' : 'Observação (opcional)', 'financeBalanceReason', 'text', '', `${hasOpening ? 'required' : ''} maxlength="500"`)}<button type="submit" class="btn full">${hasOpening ? 'Registrar correção' : 'Cadastrar saldo inicial'}</button></form>`);
}
function financeSaveBalance() {
  financeMutate(() => {
    const amount = Number($('financeBalanceAmount').value.replace(',', '.'));
    if (!$('financeBalanceAmount').value.trim() || !Number.isFinite(amount)) throw Error('Informe um saldo válido.');
    const reason = $('financeBalanceReason').value.trim();
    if (FinanceCore.ensure(db).openingBalance && !reason) throw Error('Informe o motivo da correção do saldo.');
    FinanceCore.setCurrentBalance(db, amount, $('financeBalanceDate').value, reason);
  });
}
function financeOpenRecurring(id = '') {
  const rule = FinanceCore.ensure(db).recurringBills.find(item => item.id === id) || { description: '', category: 'Outros', fixed: true, expectedAmount: '', dueDay: 10, startMonth: financeSettingsSelectedMonth || dateToday.slice(0, 7), endMonth: '', active: true };
  const card = !!rule.cardId || /^card:(nubank|mercado_pago)$/.test(rule.id || '');
  const amountFields = card ? '<p class="footer-note">O valor da fatura vem das compras e parcelas do cartão. Ajuste aqui somente o cadastro e o vencimento.</p>' : `<div class="fields two"><label class="field">Tipo de conta<select id="financeRecurringType" data-onchange="financeUpdateRecurringType()"><option value="fixed" ${rule.fixed ? 'selected' : ''}>Fixa</option><option value="variable" ${rule.fixed ? '' : 'selected'}>Variável</option></select></label>${financeInput('Valor previsto (R$)', 'financeRecurringAmount', 'number', rule.expectedAmount ?? '', `${rule.fixed ? 'required' : ''} min="0" step="0.01" placeholder="Sem previsão"`)}</div><p class="footer-note">Contas fixas exigem valor. Em contas variáveis, deixe vazio se ainda não conhecer a previsão.</p>`;
  modal(id ? 'Editar conta recorrente' : 'Nova conta recorrente', `<form class="fields" data-onsubmit="event.preventDefault();financeSaveRecurring(${financeArgument(id)})">${financeInput('Descrição', 'financeRecurringDescription', 'text', rule.description, 'required maxlength="180"')}<label class="field">Categoria<select id="financeRecurringCategory">${financeCategories(rule.category)}</select></label>${amountFields}<div class="fields two">${financeInput('Dia do vencimento', 'financeRecurringDue', 'number', rule.dueDay, 'required min="1" max="31" step="1"')}<label class="field">Situação<select id="financeRecurringActive"><option value="true" ${rule.active ? 'selected' : ''}>Ativa</option><option value="false" ${rule.active ? '' : 'selected'}>Inativa</option></select></label></div><div class="fields two">${financeInput('Mês de início', 'financeRecurringStart', 'month', rule.startMonth, 'required')}${financeInput('Mês final (opcional)', 'financeRecurringEnd', 'month', rule.endMonth || '')}</div><p class="footer-note">Uma conta é gerada por mês. Alterações preservam contas já pagas.</p><button type="submit" class="btn full">Salvar recorrência</button></form>`);
}
function financeUpdateRecurringType() { $('financeRecurringAmount').required = $('financeRecurringType').value === 'fixed'; }
function financeSaveRecurring(id = '') {
  financeMutate(() => {
    const existing=FinanceCore.ensure(db).recurringBills.find(rule=>rule.id===id);
    const card=!!existing?.cardId || /^card:(nubank|mercado_pago)$/.test(id);
    const fixed=card?existing.fixed:$('financeRecurringType').value==='fixed';
    FinanceCore.saveRecurring(db, { ...(id ? { id } : {}), ...(existing?.cardId?{cardId:existing.cardId}:{}), description: $('financeRecurringDescription').value.trim(), category: $('financeRecurringCategory').value, fixed, expectedAmount:card?existing.expectedAmount:financeAmount('financeRecurringAmount', !fixed), dueDay: Number($('financeRecurringDue').value), startMonth: $('financeRecurringStart').value, endMonth: $('financeRecurringEnd').value || null, active: $('financeRecurringActive').value === 'true' });
    FinanceCore.syncMonth(db, financeSettingsSelectedMonth || dateToday.slice(0, 7));
    if (financeBillsSelectedMonth) FinanceCore.syncMonth(db, financeBillsSelectedMonth);
  });
}
function financeSettingsMonthChanged() {
  financeSettingsSelectedMonth = financeMonth('financeSettingsMonth');
  renderFinanceSettings();
}
function renderFinanceSettings() {
  const target = $('financeSettingsContent');
  if (!target) return;
  const month = financeSettingsSelectedMonth || dateToday.slice(0, 7);
  financeSettingsSelectedMonth = month;
  financeSync(month);
  const finance = FinanceCore.ensure(db);
  target.innerHTML = `<section class="card"><div class="finance-heading"><h3>Planejamento financeiro</h3>${financeInput('Mês', 'financeSettingsMonth', 'month', month, 'required data-onchange="financeSettingsMonthChanged()"')}</div>${financePlanForm(month, 'settings')}</section>
    <section class="card"><div class="finance-heading"><h3>Contas recorrentes</h3><button type="button" class="btn small" data-onclick="financeOpenRecurring()">+ Recorrência</button></div>${finance.recurringBills.length ? finance.recurringBills.map(rule => `<article class="finance-recurring"><div><strong>${esc(rule.description)}</strong><small>${esc(rule.category)} · ${rule.fixed ? 'Fixa' : 'Variável'} · Dia ${rule.dueDay}</small><small>${esc(financeMonthLabel(rule.startMonth))}${rule.endMonth ? ' até ' + esc(financeMonthLabel(rule.endMonth)) : ' em diante'}</small></div><div><strong>${rule.cardId ? 'Fatura automática' : rule.expectedAmount == null ? 'Sem previsão' : esc(money(rule.expectedAmount))}</strong><span class="pill ${rule.active ? 'green' : 'gray'}">${rule.active ? 'Ativa' : 'Inativa'}</span><button type="button" class="btn outline small" data-onclick="financeOpenRecurring(${financeArgument(rule.id)})" aria-label="Editar ${esc(rule.description)}">Editar</button></div></article>`).join('') : '<p class="empty">Cadastre contas fixas e variáveis para organizar os próximos meses.</p>'}</section>
    <section class="card"><div class="finance-heading"><h3>Saldo atual e histórico</h3><button type="button" class="btn outline small" data-onclick="financeOpenBalance()">${finance.openingBalance ? 'Conferir / corrigir' : 'Cadastrar saldo'}</button></div><div class="finance-balance-value">${esc(money(FinanceCore.currentBalance(db, dateToday)))}</div><p class="footer-note">Saldo cadastrado atualizado pelos lançamentos até ${financeDateLabel(dateToday)}.</p>${finance.openingBalance ? `<div class="finance-audit"><strong>Ponto inicial · ${financeDateLabel(finance.openingBalance.date)}</strong><span>${esc(money(finance.openingBalance.amount))}</span></div>` : '<p class="notice">O saldo inicial ainda não foi cadastrado.</p>'}${[...finance.adjustments].reverse().map(adjustment => `<article class="finance-audit"><div><strong>${financeDateLabel(adjustment.date)} · ${esc(adjustment.reason)}</strong><small>${esc(money(adjustment.before))} → ${esc(money(adjustment.after))}</small></div><span>${adjustment.delta >= 0 ? '+' : '−'} ${esc(money(Math.abs(adjustment.delta)))}</span></article>`).join('')}<p class="footer-note">O ponto inicial e as correções anteriores são preservados. Corrigir saldo exige um motivo e não cria receita ou despesa.</p></section>`;
}


'use strict';

let managementAccounts=[],managementBusy=false,managementEpoch=0;
function dashboardAllowed(){return unlocked&&capabilities.admin&&profile==='personal'&&currentUsername==='jefferson'}
function clearManagementDashboard(){managementAccounts=[];managementBusy=false;managementEpoch++;if($('dashboardContent'))$('dashboardContent').innerHTML=''}
async function openManagementDashboard(){
 if(!dashboardAllowed())return alert('Este painel está disponível somente para Jefferson.');
 navigate('dashboard');await loadManagementDashboard();
}
async function loadManagementDashboard(){
 if(!dashboardAllowed()||managementBusy)return;
 const epoch=++managementEpoch;
 $('dashboardContent').innerHTML='<div class="card"><p class="muted">Carregando os dois ambientes…</p></div>';
 try{
  await saveChain;if(saveFailed)throw Error('Há alterações não salvas. Recarregue antes de abrir o painel.');
  const result=await api('adminOverview');
  if(epoch!==managementEpoch||!dashboardAllowed())return;
  managementAccounts=result.accounts;renderManagementDashboard();
 }catch(error){if(epoch===managementEpoch)$('dashboardContent').innerHTML='<div class="notice warn">'+esc(error.message)+'</div>'}
}
function dashboardAccount(target){const account=managementAccounts.find(item=>item.profile===target);if(!account)throw Error('Ambiente indisponível. Atualize o painel.');return account}
function dashboardInput(label,id,type,value,extra=''){return '<label class="field">'+label+'<input id="'+id+'" type="'+type+'" value="'+esc(value??'')+'" '+extra+'></label>'}
function dashboardEnvironment(account,month){
 const data=account.data,schedule=account.configuration?.clinicSchedule,catalog=account.configuration?.serviceCatalog||[];FinanceCore.ensureCreditCards(data,month);FinanceCore.syncMonth(data,month);
 const finance=FinanceCore.ensure(data),summary=FinanceCore.monthlySummary(data,month,dateToday),p='dash_'+account.profile,studio=account.profile==='podo',plan=finance.monthlyPlans.find(item=>item.month===month)||{expectedIncome:0,reserveMode:'amount',reserveValue:0,reserveDueDay:10};
 const bills=finance.bills.filter(b=>b.month===month&&b.status==='pending'),unknown=summary.pendingUnknown;
 const metrics=[['Saldo disponível',summary.balance],['Entradas do mês',summary.income],['Contas pendentes',summary.pending],['Gastos e contas pagos',summary.spending+summary.billsPaid],['Reserva realizada',summary.reserved],['Após contas conhecidas',summary.freeAfterBills]];
 return '<article class="dashboard-environment"><div class="dashboard-env-header"><div><p class="dashboard-eyebrow">'+(studio?'CONSULTÓRIO':'FINANÇAS PESSOAIS')+'</p><h3>'+(studio?'Raquel · Podologia':'Jefferson · Pessoal')+'</h3></div><span class="pill">'+(studio?(account.appointmentCounts?.[month]||0)+' compromisso(s)':finance.recurringBills.filter(r=>r.active).length+' recorrente(s)')+'</span></div>'+
 '<div class="dashboard-metrics">'+metrics.map(([label,value])=>'<div class="kpi"><div class="lbl">'+label+'</div><div class="num '+(value<0?'negative':'')+'">'+money(value)+'</div></div>').join('')+'</div>'+
 (unknown?'<p class="notice warn">'+unknown+' conta(s) sem valor previsto. A previsão não inclui esses valores.</p>':'')+
 '<div class="card"><h3>Contas do mês</h3>'+(bills.length?bills.sort((a,b)=>a.dueDate.localeCompare(b.dueDate)).slice(0,8).map(b=>'<div class="item"><div><b>'+esc(b.description)+'</b><small>Vencimento '+esc(b.dueDate.split('-').reverse().join('/'))+'</small></div><b>'+(b.expectedAmount===null?'A definir':money(b.expectedAmount))+'</b></div>').join(''):'<p class="muted">Nenhuma conta pendente neste mês.</p>')+'</div>'+
 '<form class="card fields" data-onsubmit="event.preventDefault();saveDashboardSettings(\''+account.profile+'\')"><h3>Configurações deste ambiente</h3><p class="footer-note">Os valores abaixo são salvos somente neste ambiente.</p>'+
 dashboardInput(finance.openingBalance?'Saldo disponível para conferir (R$)':'Cadastrar saldo atual (R$)',p+'_balance','number',finance.openingBalance?summary.balance:'','step="0.01" placeholder="Informe o saldo atual"')+
 dashboardInput('Motivo da correção do saldo',p+'_reason','text','','maxlength="500" placeholder="Obrigatório ao corrigir um saldo já cadastrado"')+
 '<div class="divider"></div><h3>Planejamento de '+esc(month.split('-').reverse().join('/'))+'</h3>'+dashboardInput('Renda prevista do mês (R$)',p+'_income','number',plan.expectedIncome,'min="0" step="0.01" required')+
 '<div class="fields two"><label class="field">Meta da reserva<select id="'+p+'_mode"><option value="amount" '+(plan.reserveMode==='amount'?'selected':'')+'>Valor fixo em reais</option><option value="percentage" '+(plan.reserveMode==='percentage'?'selected':'')+'>Percentual da renda prevista</option></select></label>'+dashboardInput('Valor ou percentual',p+'_reserve','number',plan.reserveValue,'min="0" step="0.01" required')+'</div>'+dashboardInput('Dia de vencimento da reserva',p+'_day','number',plan.reserveDueDay,'min="1" max="31" step="1" required')+
 (studio?'<div class="divider"></div><h3>Jornada da agenda</h3><div class="fields two">'+dashboardInput('Início',p+'_start','time',schedule.start,'required')+dashboardInput('Fim',p+'_end','time',schedule.end,'required')+'</div><div class="fields two">'+dashboardInput('Início do almoço',p+'_lunch','time',schedule.lunch,'required')+dashboardInput('Almoço (minutos)',p+'_lunchDuration','number',schedule.lunchDuration,'min="60" max="240" step="1" required')+'</div>':'')+
 '<button class="btn full" type="submit">Salvar configurações</button></form>'+
 '<div class="card"><div class="flex"><h3>Contas recorrentes</h3><button class="btn secondary small" data-onclick="dashboardOpenRecurring(\''+account.profile+'\')">+ Recorrência</button></div>'+(finance.recurringBills.map((rule,index)=>'<div class="item"><div><b>'+esc(rule.description)+'</b><small>'+(rule.fixed?'Fixa':'Variável')+' · '+(rule.cardId?'Fatura automática':rule.expectedAmount===null?'Valor a definir':money(rule.expectedAmount))+' · dia '+rule.dueDay+' · '+(rule.active?'Ativa':'Pausada')+'</small></div><button class="btn outline small" data-onclick="dashboardOpenRecurring(\''+account.profile+'\','+index+')">Editar</button></div>').join('')||'<p class="muted">Nenhuma recorrência cadastrada.</p>')+'</div>'+
 (studio?'<div class="card"><div class="flex"><h3>Serviços</h3><button class="btn secondary small" data-onclick="dashboardOpenService()">+ Serviço</button></div>'+catalog.map((service,index)=>service.archived?'':'<div class="item"><div><b>'+esc(service.name)+'</b><small>'+service.duration+' min · '+money(service.price)+'</small></div><button class="btn outline small" data-onclick="dashboardOpenService('+index+')">Editar</button><button class="btn danger small" data-onclick="dashboardDeleteService('+index+')">Excluir</button></div>').join('')+'</div>':'')+
 '<div class="card"><h3>Histórico de correções de saldo</h3>'+(finance.adjustments.slice().reverse().slice(0,10).map(a=>'<div class="item"><div><b>'+esc(a.reason)+'</b><small>'+esc(a.date)+' · '+money(a.before)+' → '+money(a.after)+'</small></div><span>'+money(a.delta)+'</span></div>').join('')||'<p class="muted">Nenhuma correção registrada.</p>')+'</div></article>';
}
function renderManagementDashboard(){
 if(!dashboardAllowed())return;
 if(!managementAccounts.length)return;
 const month=$('dashboardMonth').value||dateToday.slice(0,7);
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return;
 $('dashboardContent').innerHTML='<div class="dashboard-grid">'+managementAccounts.map(account=>dashboardEnvironment(account,month)).join('')+'</div>';
}
async function dashboardSave(target,patch){
 if(!dashboardAllowed())throw Error('Acesso restrito a Jefferson.');
 if(managementBusy)throw Error('Aguarde o salvamento em andamento.');
 managementBusy=true;const epoch=managementEpoch;
 const controls=Array.from(document.querySelectorAll?.('button,input,select,textarea')||[]).map(control=>[control,control.disabled]);
 controls.forEach(([control])=>control.disabled=true);document.body.classList.add('management-saving');
 try{
  await saveChain;if(saveFailed)throw Error('Há alterações não salvas neste aparelho. Recarregue a página.');
  const account=dashboardAccount(target),result=await api('adminSaveSettings',{targetProfile:target,revision:account.revision,...patch});
  if(epoch!==managementEpoch||!dashboardAllowed())return;
  Object.assign(account,result);
  if(target===profile){
   db=result.data;revision=result.revision;renderAll();await saveChain;
   if(saveFailed)throw Error('A configuração foi salva, mas houve uma falha ao atualizar as contas. Recarregue a página.');
   if(epoch!==managementEpoch||!dashboardAllowed())return;
   account.data=db;account.revision=revision;
  }
  renderManagementDashboard();closeModal();
 }finally{managementBusy=false;controls.forEach(([control,disabled])=>control.disabled=disabled);document.body.classList.remove('management-saving')}
}
async function saveDashboardSettings(target){
 try{
  const account=dashboardAccount(target),data=JSON.parse(JSON.stringify(account.data)),p='dash_'+target,month=$('dashboardMonth').value||dateToday.slice(0,7),balance=$(p+'_balance').value;
  if(balance!==''){
   const amount=Number(balance),current=FinanceCore.currentBalance(data,dateToday);
   if(!data.finance?.openingBalance||Math.round(amount*100)!==Math.round(current*100))FinanceCore.setCurrentBalance(data,amount,dateToday,$(p+'_reason').value.trim());
  }
  FinanceCore.setMonthPlan(data,month,{expectedIncome:Number($(p+'_income').value),reserveMode:$(p+'_mode').value,reserveValue:Number($(p+'_reserve').value),reserveDueDay:Number($(p+'_day').value)});
  const patch={finance:data.finance};
  if(target==='podo')patch.settings={start:$(p+'_start').value,end:$(p+'_end').value,lunch:$(p+'_lunch').value,lunchDuration:Number($(p+'_lunchDuration').value)};
  await dashboardSave(target,patch);
 }catch(error){alert(error.message)}
}
function dashboardOpenRecurring(target,index=-1){
 if(!dashboardAllowed())return;
 const account=dashboardAccount(target),rule=FinanceCore.ensure(account.data).recurringBills[index],month=$('dashboardMonth').value||dateToday.slice(0,7);
 const card=!!rule?.cardId || /^card:(nubank|mercado_pago)$/.test(rule?.id || '');
 const html='<form class="fields" data-onsubmit="event.preventDefault();dashboardSaveRecurring(\''+target+'\','+index+')">'+dashboardInput('Descrição','dashRuleName','text',rule?.description||'','maxlength="120" required')+dashboardInput('Categoria','dashRuleCategory','text',rule?.category||'Outros','maxlength="120" required')+(card?'<p class="footer-note">O valor da fatura vem das compras e parcelas do cartão. Ajuste aqui somente o cadastro e o vencimento.</p>':('<label class="field">Tipo<select id="dashRuleType"><option value="fixed" '+(rule?.fixed?'selected':'')+'>Valor fixo</option><option value="variable" '+(!rule?.fixed?'selected':'')+'>Valor variável</option></select></label>'+dashboardInput('Valor previsto (R$) · opcional para variável','dashRuleAmount','number',rule?.expectedAmount??'','min="0" step="0.01"')))+dashboardInput('Dia de vencimento','dashRuleDay','number',rule?.dueDay||10,'min="1" max="31" required')+'<div class="fields two">'+dashboardInput('Primeiro mês','dashRuleStart','month',rule?.startMonth||month,'required')+dashboardInput('Último mês (opcional)','dashRuleEnd','month',rule?.endMonth||'')+'</div><label class="field">Situação<select id="dashRuleActive"><option value="true" '+(rule?.active!==false?'selected':'')+'>Ativa</option><option value="false" '+(rule?.active===false?'selected':'')+'>Pausada</option></select></label><button class="btn full" type="submit">Salvar recorrência</button></form>';
 modal('Recorrência · '+(target==='podo'?'Raquel':'Jefferson'),html);
}
async function dashboardSaveRecurring(target,index){
 try{
  const data=JSON.parse(JSON.stringify(dashboardAccount(target).data)),finance=FinanceCore.ensure(data),existing=finance.recurringBills[index],card=!!existing?.cardId || /^card:(nubank|mercado_pago)$/.test(existing?.id || ''),raw=card?'':$('dashRuleAmount').value;
  FinanceCore.saveRecurring(data,{...(existing?{id:existing.id}:{}),...(existing?.cardId?{cardId:existing.cardId}:{}),description:$('dashRuleName').value.trim(),category:$('dashRuleCategory').value.trim(),fixed:card?existing.fixed:$('dashRuleType').value==='fixed',expectedAmount:card?existing.expectedAmount:raw===''?null:Number(raw),dueDay:Number($('dashRuleDay').value),startMonth:$('dashRuleStart').value,endMonth:$('dashRuleEnd').value||null,active:$('dashRuleActive').value==='true'});
  FinanceCore.syncMonth(data,$('dashboardMonth').value||dateToday.slice(0,7));await dashboardSave(target,{finance:data.finance});
 }catch(error){alert(error.message)}
}
function dashboardOpenService(index=-1){
 if(!dashboardAllowed())return;
 const service=dashboardAccount('podo').configuration.serviceCatalog[index];
 modal('Serviço do consultório','<form class="fields" data-onsubmit="event.preventDefault();dashboardSaveService('+index+')">'+dashboardInput('Serviço','dashServiceName','text',service?.name||'','maxlength="120" required')+dashboardInput('Duração (minutos)','dashServiceDuration','number',service?.duration||60,'min="5" max="1440" step="1" required')+dashboardInput('Valor (R$)','dashServicePrice','number',service?.price??'','min="0" step="0.01" required')+'<button class="btn full" type="submit">Salvar serviço</button></form>');
}
async function dashboardSaveService(index){
 try{
  const services=JSON.parse(JSON.stringify(dashboardAccount('podo').configuration.serviceCatalog)),service={id:services[index]?.id||uid(),name:$('dashServiceName').value.trim(),duration:Number($('dashServiceDuration').value),price:Number($('dashServicePrice').value)};
  if(!service.name||!Number.isInteger(service.duration)||service.duration<5||service.duration>1440||!Number.isFinite(service.price)||service.price<0)throw Error('Informe nome, duração e valor válidos.');
  if(index<0)services.push(service);else services[index]=service;await dashboardSave('podo',{services});
 }catch(error){alert(error.message)}
}
async function dashboardDeleteService(index){
 if(!dashboardAllowed()||!confirm('Excluir este serviço do catálogo? Os atendimentos já registrados serão preservados.'))return;
 try{
  const account=dashboardAccount('podo'),services=JSON.parse(JSON.stringify(account.configuration.serviceCatalog)),service=services[index];
  if(!service)return;
  service.archived=true;
  await dashboardSave('podo',{services});
 }catch(error){alert(error.message)}
}


'use strict';
const KEY='studio_podologia_v1';const PERSONAL_KEY='studio_pessoal_v2';const AUTH_KEY='studio_auth_v2';let profile=null,unlocked=false,currentUsername='';let capabilities=Object.freeze({finance:false,clinic:false,admin:false});let sessionEpoch=0,clinicFeatures=null,lastModalFocus=null;const nowLocal=()=>{let d=new Date();return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`};const pad=n=>String(n).padStart(2,'0');const money=n=>Number(n||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const uid=()=>crypto.randomUUID?.()||String(Date.now())+Math.random();const mins=t=>{const [h,m]=t.split(':').map(Number);return h*60+m};const tstr=n=>pad(Math.floor(n/60))+':'+pad(n%60);const durationLabel=n=>n>=60?`${Math.floor(n/60)}h${n%60?pad(n%60):''}`:`${n}min`;const readableDate=d=>new Date(d+'T12:00:00').toLocaleDateString('pt-BR',{weekday:'long',day:'numeric',month:'long'});
const initial=()=>({transactions:[]});
let db=initial();let revision=0;let saveChain=Promise.resolve();let saveFailed=false;
async function api(action,extra={}){const r=await fetch('/api',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({action,...extra})});let v=await r.json();if(!r.ok)throw Object.assign(Error(v.error||'Falha de conexão'),{status:r.status,code:v.code});return v}
let sessionClosing=false;
const persist=()=>{if(!unlocked||sessionClosing)return;const epoch=sessionEpoch,snapshot=JSON.parse(JSON.stringify(db));saveChain=saveChain.then(async()=>{if(epoch!==sessionEpoch||saveFailed)return;try{const result=await api('save',{data:snapshot,revision});if(epoch===sessionEpoch)revision=result.revision}catch(e){if(epoch!==sessionEpoch)return;saveFailed=true;alert('ATENÇÃO: alteração não salva no Neon: '+e.message+' Recarregue a página para evitar perda ou sobrescrita de dados.')}});};
const $=id=>document.getElementById(id);const dateToday=nowLocal();$('todayLine').textContent=readableDate(dateToday);
function initializeViewDates(){for(const id of ['agendaDate','financeMonth','personalMonth','reserveMonth','dashboardMonth'])if($(id))$(id).value=id==='agendaDate'?dateToday:dateToday.slice(0,7);}
function requireClinic(){return unlocked&&capabilities.clinic&&profile==='podo'}

function navigate(id){
 if(!unlocked)return;
 if(typeof managementBusy!=='undefined'&&managementBusy)return;
 const allowed=!capabilities.clinic?['pessoal','reserva','configuracoes','dashboard']:['home','agenda','clientes','financas','reserva','configuracoes','ajustes'];
 if(!allowed.includes(id)||id==='dashboard'&&!capabilities.admin)id=profile==='personal'?'pessoal':'home';
 document.querySelectorAll('.page').forEach(p=>p.classList.toggle('active',p.id===id));document.querySelectorAll('.nav button').forEach(b=>b.classList.toggle('active',b.dataset.page===id));
 document.body.classList.toggle('dashboard-mode',id==='dashboard');renderAll();window.scrollTo({top:0,behavior:'instant'});
}
function renderNavigation(){
 const personal=profile==='personal',items=personal?[['pessoal','⌂','Início'],['expenses','−','Despesas'],['reserva','◈','Reserva'],['configuracoes','⚙','Configurações']]:[['home','⌂','Início'],['agenda','▦','Agenda'],['clientes','♙','Clientes'],['financas','◉','Finanças'],['reserva','\u25c8','Reserva'],['configuracoes','⚙','Configurações']];
 $('mainNav').style.gridTemplateColumns='repeat('+items.length+',1fr)';$('mainNav').classList.remove('hidden');
 $('mainNav').innerHTML=items.map(([id,icon,label])=>'<button data-page="'+id+'" data-onclick="'+(id==='expenses'?"openExpense()":"navigate('"+id+"')")+'"><span class="ico">'+icon+'</span>'+label+'</button>').join('');
}
function renderProfileSettings(){}
function modal(title,html){lastModalFocus=document.activeElement;$('modalTitle').textContent=title;$('modalContent').innerHTML=html;$('modalBack').classList.add('show');queueMicrotask(()=>$('modalContent').querySelector('input,select,textarea,button')?.focus());}
function closeModal(){$('modalBack').classList.remove('show');$('modalContent').innerHTML='';if(lastModalFocus?.isConnected)lastModalFocus.focus();lastModalFocus=null;}
function closeModalBackdrop(node,event){if(event.target===node)closeModal()}

function field(name,id,type='text',value='',required=true,extra=''){return `<label class="field">${name}<input id="${id}" type="${type}" value="${esc(value)}" ${required?'required':''} ${extra}></label>`}function formHtml(content,fn,label='Salvar'){return `<form class="fields" data-onsubmit="${esc(fn)}">${content}<button type="submit" class="btn full">${label}</button></form>`}
function openService(id){const x=db.services.find(a=>a.id===id);modal(x?'Editar serviço':'Novo serviço',formHtml(field('Nome do serviço','sName','text',x?.name||'')+`<div class="fields two">${field('Tempo (minutos)','sDuration','number',x?.duration||60,true,'min="5" step="5"')}${field('Valor (R$)','sPrice','number',x?.price??'',true,'min="0" step="0.01"')}</div>`, `saveService('${id||''}')`)+(x?'<button type="button" class="btn danger full" data-onclick="deleteService('+esc(JSON.stringify(x.id))+')">Excluir serviço</button>':''))}
function saveService(id){let name=$('sName').value.trim(),duration=Number($('sDuration').value),price=Number($('sPrice').value);if(!name||!Number.isFinite(duration)||duration<5||!Number.isFinite(price)||price<0)return alert('Preencha o serviço corretamente.');let s=db.services.find(x=>x.id===id);if(s)Object.assign(s,{name,duration,price});else db.services.push({id:uid(),name,duration,price});persist();closeModal();renderAll()}
function deleteService(id){const service=db.services.find(s=>s.id===id);if(!service||!confirm('Excluir este serviço do catálogo? Os atendimentos já registrados serão preservados.'))return;if(db.appointments.some(a=>a.serviceIds?.includes(id)))service.archived=true;else db.services=db.services.filter(s=>s.id!==id);persist();closeModal();renderAll()}
function openClient(id){return clinicFeatures?.openClient(id)}

function appointmentServiceNames(appointment){return(Array.isArray(appointment.serviceSnapshot)?appointment.serviceSnapshot:(appointment.serviceIds||[]).map(id=>db.services.find(service=>service.id===id)||{name:'Serviço antigo'})).map(service=>service.name).join(' + ')||'Serviço não informado'}
function snapshotAppointmentServices(ids){return ids.map(id=>{const service=db.services.find(s=>s.id===id);return service?{id:service.id,name:service.name,duration:service.duration,price:service.price}:{id,name:'Serviço antigo',duration:0,price:0}})}
function clientHistoryHtml(clientId){
 const appointments=db.appointments.filter(a=>a.clientId===clientId).sort((a,b)=>(b.date+' '+b.time).localeCompare(a.date+' '+a.time));
 const statusLabels={agendado:'Agendado',concluido:'Concluído',cancelado:'Cancelado'};
 return'<section aria-label="Histórico de atendimentos"><h3>Histórico de atendimentos</h3><p class="footer-note">'+appointments.filter(a=>a.status==='concluido').length+' concluído(s) · '+appointments.length+' registro(s)</p>'+(appointments.length?appointments.map(a=>'<article class="appointment-history"><div class="flex"><b>'+esc(new Date(a.date+'T12:00:00').toLocaleDateString('pt-BR'))+' · '+esc(a.time)+'</b><span class="pill '+(a.status==='concluido'?'green':'gray')+'">'+esc(statusLabels[a.status]||a.status)+'</span></div><p>'+esc(appointmentServiceNames(a))+'</p><p class="footer-note">'+esc(durationLabel(a.duration))+' · '+esc(money(a.price))+'</p>'+(a.status==='concluido'||a.treatmentNotes?'<div class="treatment-notes">'+esc(a.treatmentNotes||'Nenhum relato foi registrado neste atendimento.')+'</div>':'')+(a.completedAt?'<p class="footer-note">Concluído em '+esc(new Date(a.completedAt).toLocaleString('pt-BR'))+'</p>':'')+'<div class="actions">'+(a.status==='concluido'?'<button class="btn outline small" data-onclick="openCompleteAppointment(\''+a.id+'\',\''+clientId+'\')">'+(a.treatmentNotes?'Editar relato':'Adicionar relato')+'</button>':'')+'<button class="btn secondary small" data-onclick="appointmentActions(\''+a.id+'\')">Ver atendimento</button></div></article>').join(''):'<div class="empty">Nenhum atendimento registrado para esta cliente.</div>')+'</section>';
}
function openClientHistory(id){const client=db.clients.find(c=>c.id===id);if(!client)return;modal('Histórico da cliente','<div class="notice"><b>'+esc(client.name)+'</b><br>'+esc(client.phone)+'</div>'+clientHistoryHtml(id))}
function toggleAppointmentNotes(){if($('apNotesBox'))$('apNotesBox').classList.toggle('hidden',$('apStatus').value!=='concluido')}
function openCompleteAppointment(id,clientId=''){
 const appointment=db.appointments.find(a=>a.id===id);if(!appointment)return;
 if(appointment.type==='personal'){updateApStatus(id,'concluido');return;}
 if(appointment.status==='cancelado')return alert('Este atendimento está cancelado. Reagende antes de concluir.');
 const client=db.clients.find(c=>c.id===appointment.clientId);
 modal(appointment.status==='concluido'?'Relato do atendimento':'Concluir atendimento','<div class="notice"><b>'+esc(client?.name||'Cliente')+'</b><br>'+esc(new Date(appointment.date+'T12:00:00').toLocaleDateString('pt-BR'))+' às '+esc(appointment.time)+'<br>'+esc(appointmentServiceNames(appointment))+'</div>'+formHtml('<label class="field">O que foi feito neste atendimento?<textarea id="completionNotes" rows="7" maxlength="10000" placeholder="Descreva os procedimentos realizados e as observações deste atendimento.">'+esc(appointment.treatmentNotes||'')+'</textarea></label><p class="footer-note">Este relato ficará salvo no histórico da cliente. Ao concluir, registre o recebimento na próxima etapa.</p>',`saveAppointmentCompletion('${id}','${clientId}')`,appointment.status==='concluido'?'Salvar relato':'Concluir e salvar relato'));
}
function saveAppointmentCompletion(id,clientId=''){
 const appointment=db.appointments.find(a=>a.id===id);if(!appointment||appointment.status==='cancelado')return;
 if(appointment.type==='personal'){updateApStatus(id,'concluido');return;}
 const notes=$('completionNotes').value.trim();if(notes.length>10000)return alert('O relato deve ter até 10.000 caracteres.');
 if(appointment.status!=='concluido'){const start=mins(appointment.time),conflict=intervals(appointment.date,id).find(item=>start<item.end&&start+appointment.duration>item.start);if(conflict)return alert('Há um conflito de horários. Edite o agendamento.');}
 appointment.status='concluido';appointment.treatmentNotes=notes;appointment.completedAt=appointment.completedAt||new Date().toISOString();appointment.notesUpdatedAt=new Date().toISOString();
 if(!Array.isArray(appointment.serviceSnapshot))appointment.serviceSnapshot=snapshotAppointmentServices(appointment.serviceIds||[]);
 persist();closeModal();renderAll();if(!paymentFor(id)&&Number(appointment.price)>0)openIncome(id);else if(clientId)openClientHistory(clientId);
}
function saveClient(id){return clinicFeatures?.saveClient(id)}
function openWhatsApp(id){return clinicFeatures?.openWhatsApp(id)}

function deleteClient(id){if(db.appointments.some(a=>a.clientId===id))return alert('Cliente possui atendimentos registrados. Não é possível excluir sem apagar o histórico.');if(!confirm('Excluir cliente?'))return;db.clients=db.clients.filter(c=>c.id!==id);persist();renderAll()}
function options(items,sel){return items.map(o=>`<option value="${esc(o.id)}" ${o.id===sel?'selected':''}>${esc(o.name)}</option>`).join('')}
function appointmentServices(){let selected=[...document.querySelectorAll('.service-input:checked')].map(x=>x.value);let chosen=db.services.filter(x=>selected.includes(x.id));$('apTotals').textContent=`Tempo: ${durationLabel(chosen.reduce((a,x)=>a+x.duration,0))} • Total: ${money(chosen.reduce((a,x)=>a+x.price,0))}`}
function openAppointment(id,defaults={}){
 const a=db.appointments.find(x=>x.id===id),personal=a?a.type==='personal':defaults.type==='personal',chosen=a?.serviceIds||(defaults.serviceId?[defaults.serviceId]:[]);
 const html=`<label class="field">Tipo de agendamento<select id="apType" data-onchange="toggleAppointmentType()" ${a?'disabled':''}><option value="service" ${personal?'':'selected'}>Atendimento de cliente</option><option value="personal" ${personal?'selected':''}>Compromisso pessoal</option></select></label>
 <div class="fields two">${field('Data','apDate','date',a?.date||defaults.date||$('agendaDate').value||dateToday)}${field('Início','apTime','time',a?.time||defaults.time||'09:00')}</div>
 <div id="apServiceFields" class="fields ${personal?'hidden':''}"><label class="field">Cliente<select id="apClient" required>${options(db.clients,a?.clientId)}</select></label>${!db.clients.length?'<p class="footer-note">Para um atendimento, cadastre uma cliente na aba Clientes. Você já pode reservar um compromisso pessoal.</p>':''}<div class="field">Serviços da sessão<div class="service-checks">${db.services.filter(s=>!s.archived||chosen.includes(s.id)).map(s=>`<label class="service-check"><input type="checkbox" class="service-input" value="${esc(s.id)}" ${chosen.includes(s.id)?'checked':''} data-onchange="appointmentServices()"><span>${esc(s.name)} <small class="muted">· ${durationLabel(s.duration)}</small></span><b>${money(s.price)}</b></label>`).join('')||'<p class="footer-note">Cadastre serviços e suas durações na aba Ajustes.</p>'}</div><div class="notice" id="apTotals" aria-live="polite">Selecione um ou mais serviços.</div></div></div>
 <div id="apPersonalFields" class="fields ${personal?'':'hidden'}">${field('Compromisso','apPersonalTitle','text',a?.title||'',true,'maxlength="120" placeholder="Ex.: Academia, consulta, buscar os filhos"')}${field('Duração (minutos)','apPersonalDuration','number',a?.duration||60,true,'min="5" max="1440" step="1"')}<div class="notice">Reserva seu horário sem valor financeiro. Pode ser marcado fora do expediente e durante o almoço, desde que não coincida com outro compromisso.</div></div>
 <label class="field">Status<select id="apStatus" data-onchange="toggleAppointmentNotes()"><option value="agendado" ${!a||a.status==='agendado'?'selected':''}>Agendado</option><option value="concluido" ${a?.status==='concluido'?'selected':''}>Concluído</option><option value="cancelado" ${a?.status==='cancelado'?'selected':''}>Cancelado</option></select></label><div id="apTreatmentFields" class="fields ${personal?'hidden':''}"><label class="field ${a?.status==='concluido'?'':'hidden'}" id="apNotesBox">O que foi feito neste atendimento?<textarea id="apTreatmentNotes" rows="6" maxlength="10000" placeholder="Descreva os procedimentos realizados e as observações.">${esc(a?.treatmentNotes||'')}</textarea></label><div class="footer-note">Ao concluir, registre o pagamento para contabilizar o faturamento. Um agendamento não gera entrada automaticamente.</div></div>`;
 modal(a?(personal?'Editar compromisso pessoal':'Editar atendimento'):'Novo agendamento',formHtml(html,`saveAppointment('${id||''}')`));toggleAppointmentType();appointmentServices();
}
function toggleAppointmentType(){
 const personal=$('apType').value==='personal';
 for(const [id,active] of [['apServiceFields',!personal],['apPersonalFields',personal],['apTreatmentFields',!personal]]){
  const group=$(id);group.classList.toggle('hidden',!active);group.querySelectorAll('input,select,textarea').forEach(input=>input.disabled=!active);
 }
 toggleAppointmentNotes();
}
function intervals(date,except,includeLunch=true){const s=db.settings,l=mins(s.lunch),items=includeLunch?[{start:l,end:l+Number(s.lunchDuration),name:'Almoço'}]:[];db.appointments.filter(a=>a.date===date&&a.id!==except&&a.status!=='cancelado').forEach(a=>items.push({start:mins(a.time),end:mins(a.time)+Number(a.duration),name:a.type==='personal'?'Compromisso pessoal: '+a.title:'Outro atendimento'}));return items}
function freeBlocks(date,except){
 const start=mins(db.settings.start),end=mins(db.settings.end),blocks=[];
 let cursor=start;
 for(const item of intervals(date,except).sort((a,b)=>a.start-b.start)){
  const from=Math.max(start,item.start),to=Math.min(end,item.end);
  if(to<=from)continue;
  if(from>cursor)blocks.push({start:cursor,end:from});
  cursor=Math.max(cursor,to);
 }
 if(cursor<end)blocks.push({start:cursor,end});
 return blocks;
}
function saveAppointment(id){
 const a=db.appointments.find(x=>x.id===id),personal=a?a.type==='personal':$('apType').value==='personal';
 const date=$('apDate').value,time=$('apTime').value,status=$('apStatus').value;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)||!['agendado','concluido','cancelado'].includes(status))return alert('Preencha data, horário e status corretamente.');
 let record;
 if(personal){
  const title=$('apPersonalTitle').value.trim(),duration=Number($('apPersonalDuration').value);
  if(!title||title.length>120||!Number.isInteger(duration)||duration<5||duration>1440)return alert('Informe o compromisso e uma duração válida de pelo menos 5 minutos.');
  if(mins(time)+duration>1440)return alert('O compromisso deve terminar no mesmo dia.');
  record={type:'personal',title,clientId:null,serviceIds:[],date,time,duration,price:0,status};
 }else{
  const serviceIds=[...document.querySelectorAll('.service-input:checked')].map(x=>x.value),chosen=db.services.filter(s=>serviceIds.includes(s.id)&&(!s.archived||a?.serviceIds?.includes(s.id))),clientId=$('apClient').value;
  if(!db.clients.some(c=>c.id===clientId))return alert('Cadastre e escolha uma cliente na aba Clientes.');
  if(!chosen.length||chosen.length!==serviceIds.length)return alert('Escolha pelo menos um serviço cadastrado.');
  const duration=chosen.reduce((sum,s)=>sum+Number(s.duration),0),price=chosen.reduce((sum,s)=>sum+Number(s.price),0),notes=$('apTreatmentNotes').value.trim();
  if(!Number.isFinite(duration)||duration<=0||!Number.isFinite(price)||price<0)return alert('Verifique a duração e o valor dos serviços cadastrados.');
  if(notes.length>10000)return alert('O relato deve ter até 10.000 caracteres.');
  record={type:'service',clientId,date,time,serviceIds,duration,price,status,treatmentNotes:notes};
  if(status==='concluido'){record.completedAt=a?.completedAt||new Date().toISOString();record.notesUpdatedAt=new Date().toISOString();record.serviceSnapshot=a?.serviceSnapshot&&a.serviceIds?.length===serviceIds.length&&serviceIds.every(serviceId=>a.serviceIds.includes(serviceId))?a.serviceSnapshot:snapshotAppointmentServices(serviceIds)}
 }
 if(status!=='cancelado'){
  const start=mins(time),end=start+record.duration;
  if(!personal&&(start<mins(db.settings.start)||end>mins(db.settings.end)))return alert('Atendimento fora do horário de trabalho.');
  const conflict=intervals(date,id,!personal).find(x=>start<x.end&&end>x.start);
  if(conflict)return alert(`Conflito de horário com: ${conflict.name}.`);
 }
 if(a)Object.assign(a,record);else db.appointments.push({id:uid(),...record});
 persist();closeModal();$('agendaDate').value=date;renderAll();
}
function updateApStatus(id,status){let a=db.appointments.find(x=>x.id===id);if(!a)return;if(status==='concluido'&&a.type!=='personal'){openCompleteAppointment(id);return}if(status!=='cancelado'){let st=mins(a.time),conflict=intervals(a.date,id,a.type!=='personal').find(x=>st<x.end&&st+Number(a.duration)>x.start);if(conflict)return alert('Há um conflito de horários. Edite o agendamento.')}a.status=status;persist();renderAll()}
function paymentFor(id){return db.transactions.some(t=>t.appointmentId===id&&t.type==='income')}
function openIncome(id){if(id&&!requireClinic())return;let a=db.appointments?.find(x=>x.id===id);if(a?.type==='personal')return alert('Compromisso pessoal não possui pagamento.');if(a&&paymentFor(id))return alert('Este atendimento já possui um pagamento registrado.');let html=field('Descrição','iName','text',a?'Atendimento — '+(db.clients.find(c=>c.id===a.clientId)?.name||'Cliente'):'Recebimento avulso')+`<div class="fields two">${field('Valor (R$)','iAmount','number',a?.price??'',true,'min="0.01" step="0.01"')}${field('Data do recebimento','iDate','date',dateToday)}</div>`+`<label class="field">Forma de pagamento<select id="iMethod"><option>Pix</option><option>Dinheiro</option><option>Cartão</option><option>Transferência</option><option>Outro</option></select></label>`;modal('Registrar entrada',formHtml(html,`saveIncome('${id||''}')`))}
function saveIncome(apId){if(apId&&!requireClinic())return;if(db.appointments?.find(a=>a.id===apId)?.type==='personal')return alert('Compromisso pessoal não possui pagamento.');let amount=Number($('iAmount').value),description=$('iName').value.trim(),date=$('iDate').value,method=$('iMethod').value;if(!description||!(amount>0)||!date)return alert('Preencha os dados do recebimento.');if(apId&&paymentFor(apId))return alert('Pagamento já registrado.');db.transactions.push({id:uid(),type:'income',amount,description,date,method,...(apId?{appointmentId:apId}:{})});persist();closeModal();renderAll()}
const categories=['Materiais e insumos','Aluguel','Água','Energia elétrica','Internet / telefone','Transporte','Marketing','Impostos e taxas','Manutenção','Outros'];

function deleteTransaction(id){const transaction=db.transactions.find(t=>t.id===id);if(transaction?.billId)return alert('Este lançamento pertence a uma conta paga e faz parte do histórico financeiro.');const message=transaction?.paymentMethod==='credit'&&transaction.installmentCount>1?'Excluir somente a parcela '+transaction.installmentNumber+'/'+transaction.installmentCount+' desta compra? As outras parcelas serão mantidas.':'Excluir esta movimentação financeira?';if(!confirm(message))return;db.transactions=db.transactions.filter(t=>t.id!==id);persist();renderAll()}
function totals(from,to){let rows=db.transactions.filter(t=>t.date>=from&&t.date<=to);let income=rows.filter(t=>t.type==='income').reduce((a,t)=>a+t.amount,0),expense=rows.filter(t=>t.type==='expense').reduce((a,t)=>a+t.amount,0);return{income,expense,balance:income-expense}}
function renderHome(){const month=dateToday.slice(0,7),t=totals(month+'-01',dateToday);$('homeRevenue').textContent=money(t.income);$('homeExpenses').textContent=money(t.expense);$('homeBalance').textContent=money(FinanceCore.currentBalance(db,dateToday));$('homeMonth').textContent='Movimentações registradas até hoje • '+new Date(dateToday+'T12:00').toLocaleDateString('pt-BR',{month:'long',year:'numeric'});$('homeBalance').className='num '+(FinanceCore.currentBalance(db,dateToday)<0?'negative':'positive');let as=db.appointments.filter(a=>a.date===dateToday&&a.status!=='cancelado').sort((a,b)=>a.time.localeCompare(b.time));$('todayAppointments').innerHTML=as.length?as.map(a=>appointmentRow(a,true)).join(''):'<div class="empty">Nenhum atendimento agendado para hoje.</div>';renderOpportunity()}
function appointmentRow(a,compact=false){const personal=a.type==='personal',name=personal?a.title:db.clients.find(c=>c.id===a.clientId)?.name||'Cliente removida',services=personal?'Compromisso pessoal':appointmentServiceNames(a),paid=!personal&&paymentFor(a.id);return `<div class="item"><div style="min-width:0"><b>${esc(a.time)} · ${esc(name)}</b><small>${esc(services)} · ${durationLabel(a.duration)}${personal?'':' · '+money(a.price)}</small><div style="margin-top:5px"><span class="pill ${a.status==='concluido'?'green':'gray'}">${a.status==='concluido'?'Concluído':a.status==='cancelado'?'Cancelado':'Agendado'}</span> ${personal?'<span class="pill personal-pill">Pessoal</span>':''}${paid?'<span class="pill green">Pago</span>':''} ${personal?'':clinicFeatures?.riskBadge(db.clients.find(c=>c.id===a.clientId))||''}</div></div>${compact?'':`<button class="btn secondary small" data-onclick="appointmentActions('${a.id}')">Detalhes</button>`}</div>`}
function appointmentActions(id){
 const a=db.appointments.find(x=>x.id===id);if(!a)return;
 if(a.type==='personal'){
  modal('Compromisso pessoal',`<div class="notice"><b>${esc(a.title)}</b><br>${esc(a.date)} às ${esc(a.time)} · ${durationLabel(a.duration)}<br>Sem valor financeiro</div><div class="fields"><button class="btn secondary full" data-onclick="openAppointment('${id}')">Editar compromisso</button>${a.status==='agendado'?`<button class="btn full" data-onclick="updateApStatus('${id}','concluido');closeModal()">Concluir compromisso</button>`:''}${a.status!=='cancelado'?`<button class="btn danger full" data-onclick="cancelAppointment('${id}')">Cancelar compromisso</button>`:''}</div>`);return;
 }
 const c=db.clients.find(x=>x.id===a.clientId);modal('Atendimento',`<div class="notice">${esc(c?.name||'Cliente')} · ${esc(a.date)} às ${esc(a.time)}<br>${durationLabel(a.duration)} • ${money(a.price)}</div><div class="fields"><button class="btn secondary full" data-onclick="closeModal();openAppointment('${id}')">Editar horário ou serviços</button>${a.status==='agendado'?`<button class="btn full" data-onclick="openCompleteAppointment('${id}')">Concluir atendimento</button>`:''}${a.status==='concluido'?`<button class="btn outline full" data-onclick="openCompleteAppointment('${id}')">${a.treatmentNotes?'Ver / editar relato':'Adicionar relato'}</button>`:''}${a.status==='concluido'&&!paymentFor(id)?`<button class="btn full" data-onclick="openIncome('${id}')">Registrar pagamento</button>`:''}${c?.phone?`<button class="btn outline full" data-onclick="openWhatsApp('${id}')">Abrir WhatsApp</button>`:''}${a.status!=='cancelado'?`<button class="btn danger full" data-onclick="cancelAppointment('${id}')">Cancelar atendimento</button>`:''}</div>`)
}
function changeDate(offset){let d=new Date($('agendaDate').value+'T12:00:00');d.setDate(d.getDate()+offset);$('agendaDate').value=`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;renderAgenda()}
function openFreeSlot(start,serviceIndex=-1){openAppointment('',{date:$('agendaDate').value||dateToday,time:tstr(start),serviceId:db.services[serviceIndex]?.id})}
function freeSlotHtml(block){
 const span=block.end-block.start,suggestions=db.services.map((service,index)=>({service,index})).filter(({service})=>!service.archived&&Number(service.duration)>0&&Number(service.duration)<=span).sort((a,b)=>b.service.duration-a.service.duration||a.service.name.localeCompare(b.service.name)).slice(0,3);
 return `<div class="free-slot"><button type="button" class="free-slot-open" data-onclick="openFreeSlot(${block.start})"><strong>${tstr(block.start)}–${tstr(block.end)}</strong><span>${durationLabel(span)} livres</span><b>＋ Adicionar atendimento</b></button><div class="slot-suggestions">${suggestions.length?`<p class="footer-note">Cabe neste intervalo:</p><div class="actions">${suggestions.map(({service,index})=>`<button type="button" class="btn outline small" data-onclick="openFreeSlot(${block.start},${index})">${esc(service.name)} · ${durationLabel(service.duration)}</button>`).join('')}</div>`:'<p class="footer-note">Nenhum serviço cadastrado cabe neste intervalo. Você pode reservar um compromisso pessoal.</p>'}</div></div>`;
}
function renderAgenda(){
 const date=$('agendaDate').value||dateToday,s=db.settings,ap=db.appointments.filter(a=>a.date===date&&a.status!=='cancelado').sort((a,b)=>a.time.localeCompare(b.time)),blocks=freeBlocks(date),free=blocks.reduce((sum,b)=>sum+b.end-b.start,0),available=Math.max(0,mins(s.end)-mins(s.start)-Number(s.lunchDuration)),personal=ap.filter(a=>a.type==='personal').length;
 $('agendaSummary').innerHTML=`<b>${ap.length-personal} atendimento(s) · ${personal} pessoal(is)</b><br>${durationLabel(available-free)} ocupados de ${durationLabel(available)} úteis · ${durationLabel(free)} livres.<br>Almoço protegido: ${esc(s.lunch)}–${tstr(mins(s.lunch)+Number(s.lunchDuration))}.`;
 const events=[...ap.map(a=>({kind:'ap',time:a.time,a})),{kind:'lunch',time:s.lunch},...blocks.map(block=>({kind:'free',time:tstr(block.start),block}))].sort((a,b)=>a.time.localeCompare(b.time));
 $('agendaItems').innerHTML=events.map(e=>e.kind==='free'?freeSlotHtml(e.block):e.kind==='lunch'?`<div class="slot"><div class="time">${esc(e.time)}</div><div class="slotbody"><b>🍽️ Pausa para almoço</b><div class="tag">${durationLabel(Number(s.lunchDuration))} · horário reservado</div></div></div>`:`<div class="slot ${e.a.type==='personal'?'personal-slot':''}"><div class="time">${esc(e.time)}<div class="tag">até ${tstr(mins(e.time)+Number(e.a.duration))}</div></div><div class="slotbody">${appointmentRow(e.a)}</div></div>`).join('');
}
function renderClients(){let q=$('clientSearch').value.toLowerCase();let cs=db.clients.filter(c=>c.name.toLowerCase().includes(q)||c.phone.includes(q)).sort((a,b)=>a.name.localeCompare(b.name));$('clientsList').innerHTML=cs.length?cs.map(c=>`<div class="item"><div><b>${esc(c.name)}</b><small>${esc(c.phone)}</small></div><div class="actions"><button class="btn outline small" data-onclick="openClientHistory('${c.id}')">Histórico</button><button class="btn secondary small" data-onclick="openClient('${c.id}')">Editar</button><button class="btn danger small" data-onclick="deleteClient('${c.id}')">✕</button></div></div>`).join(''):'<div class="empty">Nenhuma cliente encontrada.</div>'}
function renderFinance(){renderPersonalFinance('studioFinanceContent','financeMonth')}
function renderServices(){$('servicesList').innerHTML=db.services.some(s=>!s.archived)?db.services.filter(s=>!s.archived).map(s=>`<div class="item"><div><b>${esc(s.name)}</b><small>${durationLabel(s.duration)} · ${money(s.price)}</small></div><div class="actions"><button class="btn secondary small" data-onclick="openService('${s.id}')">Editar</button><button class="btn danger small" data-onclick="deleteService('${s.id}')">Excluir</button></div></div>`).join(''):'<div class="empty">Adicione seu primeiro serviço.</div>'}
function renderSettings(){let s=db.settings;$('workStart').value=s.start;$('workEnd').value=s.end;$('lunchStart').value=s.lunch;$('lunchDuration').value=String(s.lunchDuration)}
function saveSettings(){let s={start:$('workStart').value,end:$('workEnd').value,lunch:$('lunchStart').value,lunchDuration:Number($('lunchDuration').value)};if(mins(s.start)>=mins(s.end)||mins(s.lunch)<mins(s.start)||mins(s.lunch)+s.lunchDuration>mins(s.end))return alert('Almoço deve caber integralmente na jornada.');let conflict=db.appointments.find(a=>a.type!=='personal'&&a.status!=='cancelado'&&(mins(a.time)<mins(s.start)||mins(a.time)+Number(a.duration)>mins(s.end)||(mins(a.time)<mins(s.lunch)+s.lunchDuration&&mins(a.time)+Number(a.duration)>mins(s.lunch))));if(conflict)return alert('Os novos horários entram em conflito com um agendamento existente. Ajuste a agenda primeiro.');db.settings=s;persist();alert('Horários salvos e almoço protegido.');renderAll()}
function renderOpportunity(){let date=$('agendaDate').value||dateToday,s=db.settings,blocks=freeBlocks(date);let candidates=[];for(let b of blocks){let span=b.end-b.start;let match=db.services.filter(x=>!x.archived&&x.duration>0&&x.duration<=span).sort((a,b)=>(b.price/b.duration)-(a.price/a.duration))[0];if(match)candidates.push({b,match,span})}candidates.sort((a,b)=>b.match.price/b.match.duration-a.match.price/a.match.duration);let top=candidates.slice(0,3);let usable=mins(s.end)-mins(s.start)-Number(s.lunchDuration),busy=Math.max(0,usable-blocks.reduce((n,b)=>n+b.end-b.start,0));$('opportunity').innerHTML=`<div class="flex"><span class="muted tiny">Ocupação de ${esc(readableDate(date))}</span><b>${usable>0?Math.round(busy/usable*100):0}%</b></div><div class="progress" style="margin:9px 0 15px"><div style="width:${usable>0?Math.min(100,Math.round(busy/usable*100)):0}%"></div></div>`+(top.length?top.map(c=>`<p class="tip">⏱️ <b>${tstr(c.b.start)}–${tstr(c.b.end)}</b>: intervalo de ${durationLabel(c.span)}. Cabe <b>${esc(c.match.name)}</b> (${durationLabel(c.match.duration)}, ${money(c.match.price)}). <button class="btn secondary small" data-onclick="navigate('agenda')">Ver dia</button></p>`).join(''):'<p class="tip muted">Não há intervalos livres compatíveis com os serviços cadastrados.</p>')+`<div class="divider"></div><div class="footer-note">As sugestões respeitam os atendimentos, os compromissos pessoais e o almoço. Confira os serviços e confirme com a cliente antes de agendar.</div>`}
function renderAll(){if(!unlocked)return;if(capabilities.clinic){renderHome();renderAgenda();renderClients();renderFinance();renderServices();renderSettings();}else renderPersonal();renderFinanceSettings();renderReservePage();}

const expenseCategories=['Materiais e insumos','Alimentação','Mercado','Moradia','Água','Energia elétrica','Internet / telefone','Transporte','Saúde','Educação','Lazer','Aluguel','Marketing','Impostos e taxas','Manutenção','Outros'];
function guessCategory(text){let t=text.toLocaleLowerCase('pt-BR');for(let [re,c] of [[/farm[aá]cia|rem[eé]dio|medicamento|consulta|hospital/,'Saúde'],[/mercado|supermercado|hortifruti|a[cç]ougue|atacad/,'Mercado'],[/restaurante|lanchonete|pizza|lanche|caf[eé]/,'Alimentação'],[/posto|gasolina|combust[ií]vel|uber|estacionamento/,'Transporte'],[/esmalte|luva|alicate|instrumento|descart[aá]vel|podolog/,'Materiais e insumos'],[/energia|el[eé]trica|celesc/,'Energia elétrica'],[/internet|telefone|vivo|claro|tim/,'Internet / telefone']])if(re.test(t))return c;return 'Outros'}
function openExpense(){openFinanceExpenses('bills')}
function expenseCardSelectHtml(){return '<label class="field">Cartão de crédito<select id="eCreditCard" required disabled data-onchange="updateExpensePaymentPreview()"><option value="">Selecione o cartão</option><option value="nubank">Nubank</option><option value="mercado_pago">Mercado Pago</option></select></label>'}
function renderSpendingForm(){return `<div class="notice">Adicione quantos produtos quiser. O total é calculado automaticamente.</div><label class="field">Título da despesa<input id="eDescription" placeholder="Ex.: Compras na farmácia" required data-oninput="suggestExpenseCategory()"></label><div class="fields two"><label class="field">Data da compra<input id="eDate" type="date" value="${dateToday}" required data-onchange="syncExpensePurchaseDate()"></label><label class="field">Categoria<select id="eCategory">${expenseCategories.map(c=>`<option>${esc(c)}</option>`).join('')}<option value="Personalizada">+ Nova categoria</option></select></label></div><label class="field">Categoria personalizada (opcional)<input id="eCustom" placeholder="Ex.: Presentes"></label><div class="divider"></div><div class="flex"><b>Itens da compra</b><button type="button" class="btn secondary small" data-onclick="addExpenseLine()">+ Item</button></div><div class="expense-line tiny muted"><span>Produto / descrição</span><span>Qtd.</span><span>Preço un.</span><span></span></div><div id="eLines"></div><div class="flex" style="margin:12px 0"><strong>TOTAL</strong><strong id="expenseTotal">R$ 0,00</strong></div><div class="divider"></div><label class="field">Como foi paga esta despesa?<select id="ePaymentMethod" required data-onchange="updateExpensePayment()"><option value="">Selecione a forma de pagamento</option><option value="debit">Débito</option><option value="cash">Dinheiro</option><option value="credit">Crédito</option></select></label><div id="eCreditFields" class="hidden">${expenseCardSelectHtml()}<div class="fields two"><label class="field">Número de parcelas<input id="eInstallments" type="number" value="1" min="1" max="120" step="1" disabled data-oninput="updateExpensePaymentPreview()"></label><label class="field">Mês da primeira parcela<input id="eFirstMonth" type="month" value="${dateToday.slice(0,7)}" min="${dateToday.slice(0,7)}" disabled data-oninput="updateExpensePaymentPreview()"></label></div><p class="footer-note">Se a fatura do cartão já fechou, selecione o mês da próxima fatura. As demais parcelas serão lançadas nos meses seguintes.</p></div><div id="expensePaymentPreview" class="notice" aria-live="polite" style="margin-top:12px">Selecione a forma de pagamento.</div><button type="button" class="btn full" data-onclick="saveExpense()">Salvar despesa</button>`}
function showSpendingFields(){addExpenseLine();updateExpensePayment()}
function addExpenseLine(name='',qty=1,unit=''){const row=document.createElement('div');row.className='expense-line';row.innerHTML=`<input class="elname" aria-label="Nome do item" placeholder="Produto" value="${esc(name)}"><input class="elqty" aria-label="Quantidade" type="number" min="0.01" step="0.01" value="${qty}" data-oninput="updateExpenseTotal()"><input class="elunit" aria-label="Preço unitário" type="number" min="0" step="0.01" placeholder="0,00" value="${esc(unit)}" data-oninput="updateExpenseTotal()"><button class="btn danger small" type="button" aria-label="Remover item" data-onclick="removeExpenseLine()">×</button>`;$('eLines').appendChild(row);updateExpenseTotal()}
function expenseItems(){return [...document.querySelectorAll('#eLines .expense-line')].map(x=>({name:x.querySelector('.elname').value.trim(),qty:Number(x.querySelector('.elqty').value),unit:Number(x.querySelector('.elunit').value)}))}
function updateExpenseTotal(){if(!$('expenseTotal'))return;$('expenseTotal').textContent=money(expenseItems().reduce((s,x)=>s+(Number.isFinite(x.qty)&&Number.isFinite(x.unit)?x.qty*x.unit:0),0));updateExpensePaymentPreview()}
function suggestExpenseCategory(){let s=$('eDescription')?.value||'';if(s&&$('eCategory').value==='Materiais e insumos')$('eCategory').value=guessCategory(s)}
function planExpensePayments(totalCents,paymentMethod,count,firstMonth,purchaseDate){
 if(!Number.isSafeInteger(totalCents)||totalCents<1||totalCents>10000000000)throw Error('Informe um valor total válido para a despesa.');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(purchaseDate)||!Number.isFinite(Date.parse(purchaseDate+'T12:00:00Z'))||new Date(purchaseDate+'T12:00:00Z').toISOString().slice(0,10)!==purchaseDate)throw Error('Informe uma data de compra válida.');
 if(!['debit','cash','credit'].includes(paymentMethod))throw Error('Selecione débito, dinheiro ou crédito.');
 if(paymentMethod!=='credit')return[{date:purchaseDate,amount:totalCents/100}];
 if(!Number.isInteger(count)||count<1||count>120)throw Error('Informe de 1 a 120 parcelas inteiras.');
 if(count>totalCents)throw Error('O valor de cada parcela deve ser de pelo menos R$ 0,01.');
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(firstMonth)||firstMonth<purchaseDate.slice(0,7))throw Error('Escolha o mês da primeira parcela, a partir do mês da compra.');
 const [year,month]=firstMonth.split('-').map(Number),start=year*12+month-1;
 if(Math.floor((start+count-1)/12)>9999)throw Error('O mês da última parcela está fora do intervalo permitido.');
 const base=Math.floor(totalCents/count),remainder=totalCents%count;
 return Array.from({length:count},(_,index)=>{const current=start+index;return{date:String(Math.floor(current/12)).padStart(4,'0')+'-'+String(current%12+1).padStart(2,'0')+'-01',amount:(base+(index<remainder?1:0))/100,installmentNumber:index+1,installmentCount:count}});
}
function expenseMonthLabel(month){return new Date(month+'-01T12:00:00').toLocaleDateString('pt-BR',{month:'long',year:'numeric'})}
function expensePaymentLabel(method){return{debit:'Débito',cash:'Dinheiro',credit:'Crédito'}[method]||''}
function transactionTitle(transaction){return transaction.description+(transaction.paymentMethod==='credit'?' — parcela '+transaction.installmentNumber+'/'+transaction.installmentCount:'')}
function transactionDateLabel(transaction){return transaction.paymentMethod==='credit'?'Fatura de '+expenseMonthLabel(transaction.date.slice(0,7)):new Date(transaction.date+'T12:00:00').toLocaleDateString('pt-BR')}
function transactionPaymentInfo(transaction){if(!transaction.paymentMethod)return'';return' · '+expensePaymentLabel(transaction.paymentMethod)+(transaction.paymentMethod==='credit'?' · Compra em '+new Date(transaction.purchaseDate+'T12:00:00').toLocaleDateString('pt-BR')+' · Total da compra '+money(transaction.purchaseAmount):'')}
function syncExpensePurchaseDate(){
 if(!$('eFirstMonth'))return;
 const month=$('eDate').value.slice(0,7);$('eFirstMonth').min=month;
 if(!$('eFirstMonth').value||$('eFirstMonth').value<month)$('eFirstMonth').value=month;
 updateExpensePaymentPreview();
}
function updateExpensePayment(){
 const credit=$('ePaymentMethod').value==='credit';$('eCreditFields').classList.toggle('hidden',!credit);
 for(const id of ['eInstallments','eFirstMonth','eCreditCard']){$(id).disabled=!credit;$(id).required=credit}
 syncExpensePurchaseDate();
}
function updateExpensePaymentPreview(){
 const preview=$('expensePaymentPreview');if(!preview)return;
 const method=$('ePaymentMethod').value;
 if(!method){preview.textContent='Selecione a forma de pagamento.';return}
 const cents=Math.round(expenseItems().reduce((sum,item)=>sum+(Number.isFinite(item.qty)&&Number.isFinite(item.unit)?item.qty*item.unit:0),0)*100);
 if(cents<=0){preview.textContent='Adicione os itens para visualizar o pagamento.';return}
 try{
  const plan=planExpensePayments(cents,method,Number($('eInstallments').value),$('eFirstMonth').value,$('eDate').value);
  if(method!=='credit'){preview.textContent=expensePaymentLabel(method)+': '+money(cents/100)+' na data da compra.';return}
  preview.innerHTML='<strong>Total da compra: '+money(cents/100)+'</strong><div class="installment-preview"><table><caption>Distribuição das parcelas</caption><thead><tr><th>Parcela</th><th>Mês da fatura</th><th>Valor</th></tr></thead><tbody>'+plan.map(part=>'<tr><td>'+part.installmentNumber+'/'+part.installmentCount+'</td><td>'+esc(expenseMonthLabel(part.date.slice(0,7)))+'</td><td>'+money(part.amount)+'</td></tr>').join('')+'</tbody></table></div><p class="footer-note">Cada parcela será somada à conta mensal do cartão escolhido. O saldo disponível será reduzido ao pagar a fatura em Contas.</p>';
 }catch(error){preview.textContent=error.message}
}
function saveExpense(){
 const items=expenseItems(),description=$('eDescription').value.trim(),purchaseDate=$('eDate').value,category=$('eCategory').value==='Personalizada'?$('eCustom').value.trim():$('eCategory').value;
 const cents=Math.round(items.reduce((sum,item)=>sum+item.qty*item.unit,0)*100);
 if(!description||!category||!items.length||items.some(item=>!item.name||!Number.isFinite(item.qty)||item.qty<=0||!Number.isFinite(item.unit)||item.unit<0))return alert('Informe título, categoria e itens com quantidade e preço corretos.');
 const paymentMethod=$('ePaymentMethod').value;let plan;
 try{plan=planExpensePayments(cents,paymentMethod,Number($('eInstallments').value),$('eFirstMonth').value,purchaseDate)}catch(error){return alert(error.message)}
 if(db.transactions.length+plan.length>25000)return alert('O limite de lançamentos deste perfil foi atingido.');
 if(paymentMethod==='credit'){
  const cardId=$('eCreditCard').value;
  if(!['nubank','mercado_pago'].includes(cardId))return alert('Selecione o cartão Nubank ou Mercado Pago.');
  try{FinanceCore.recordCreditPurchase(db,{cardId,description,category,purchaseDate,amount:cents/100,items,installments:plan})}catch(error){return alert(error.message)}
  persist();closeModal();renderAll();return;
 }
 const transactions=plan.map(part=>({id:uid(),type:'expense',description,category,items,purchaseDate,paymentMethod,method:expensePaymentLabel(paymentMethod),...part}));
 db.transactions.push(...transactions);persist();closeModal();renderAll();
}
function renderPersonal(){renderPersonalFinance()}

let registered=false,setupAvailable=false,authReady=false,authBusy=false,registrationMode=false,passwordChangeProfile=null;
async function loadView(path){const response=await fetch('/views/'+path+'.html?v=secure-views-1',{credentials:'same-origin'});if(!response.ok)throw Error('Não foi possível carregar as telas. Recarregue a página.');return response.text()}
async function mountAuthorizedViews(epoch){
 const views=await Promise.all([loadView('common'),loadView(capabilities.clinic?'clinic':'personal'),...(capabilities.admin?[loadView('admin')]:[])]);
 if(epoch!==sessionEpoch)return false;
 $('appContent').innerHTML=views.join('');
 for(const id of ['studioSettingsAccess','dashboardAccess'])if($(id))$('settingsCapabilities').appendChild($(id));
 initializeViewDates();
 if(capabilities.clinic){
  const {createClinicFeatures}=await import('./clinic-features.js');
  if(epoch!==sessionEpoch)return false;
  clinicFeatures=createClinicFeatures({get db(){return db},$,esc,uid,modal,field,formHtml,persist,closeModal,renderAll,clientHistoryHtml,paymentFor,openIncome,dateToday,requireClinic});
 }
 return epoch===sessionEpoch;
}
function clearAuthSecrets(){for(const id of ['authPassword','authPasswordConfirm','setupCode'])$(id).value='';$('authPassword').type='password';$('authPasswordConfirm').type='password';$('passwordToggle').textContent='Mostrar';$('passwordToggle').setAttribute('aria-pressed','false')}
function toggleAuthPassword(){const show=$('authPassword').type==='password';$('authPassword').type=show?'text':'password';$('authPasswordConfirm').type=show?'text':'password';$('passwordToggle').textContent=show?'Ocultar':'Mostrar';$('passwordToggle').setAttribute('aria-pressed',String(show))}
function updateAuthForm(){
 const changing=passwordChangeProfile!==null,creating=registrationMode&&!changing;
 $('authAction').disabled=!authReady||authBusy;
 $('authAction').textContent=!authReady?'Aguarde…':changing?'Salvar nova senha e entrar':creating?'Criar acesso inicial':'Entrar';
 $('authHeading').textContent=changing?'Defina sua nova senha':creating?'Ativar conta inicial':'Entrar no Finança Fácil';
 $('authMessage').textContent=changing?'Escolha uma nova senha para continuar.':creating?'Use o código de ativação fornecido pelo responsável.':'Entre com seu usuário e sua senha.';
 $('authPasswordLabel').textContent=changing||creating?'Nova senha':'Sua senha';
 $('authPasswordHelp').textContent=changing||creating?'Escolha de 10 a 128 caracteres.':'Use a senha cadastrada para sua conta.';
 $('authPassword').disabled=!authReady||authBusy;$('authPassword').minLength=changing||creating?10:1;$('authPassword').autocomplete=changing||creating?'new-password':'current-password';
 $('authUsername').readOnly=changing;$('authUsername').disabled=authBusy;
 $('confirmBox').classList.toggle('hidden',!changing&&!creating);$('authPasswordConfirm').required=changing||creating;$('authPasswordConfirm').disabled=!changing&&!creating;
 $('setupBox').classList.toggle('hidden',!creating);$('setupCode').required=creating;$('setupCode').disabled=!creating;
 $('authCancel').classList.toggle('hidden',!changing);
 $('authRegistration').classList.toggle('hidden',!setupAvailable||changing);$('authRegistration').textContent=creating?'Voltar ao login':'Ativar conta inicial';$('authRegistration').disabled=authBusy;
}
function toggleRegistration(){if(!authReady||authBusy||!setupAvailable||passwordChangeProfile)return;registrationMode=!registrationMode;clearAuthSecrets();$('authFeedback').textContent='';updateAuthForm()}
async function initAuth(){
 authReady=false;$('authRetry').classList.add('hidden');$('authFeedback').textContent='Verificando acesso…';updateAuthForm();
 try{
  const status=await api('status');if(typeof status.registered!=='boolean'||typeof status.setupAvailable!=='boolean')throw Error('Resposta inválida do servidor.');
  registered=status.registered;setupAvailable=status.setupAvailable;registrationMode=!registered&&setupAvailable;authReady=true;
  let me;try{me=await api('me')}catch(error){if(error.status!==401)throw error}
  if(me){await startSession(me);return}
  $('authFeedback').textContent='';updateAuthForm();
 }catch(error){authReady=false;$('authFeedback').textContent=error.message;$('authRetry').classList.remove('hidden');updateAuthForm();$('authAction').textContent='Acesso indisponível'}
}
function showPasswordChange(result){passwordChangeProfile=result.profile;registrationMode=false;$('authUsername').value=result.username||'';clearAuthSecrets();$('authVeil').classList.remove('hidden');updateAuthForm()}
async function startSession(result){
 if(result.mustChangePassword){showPasswordChange(result);return}
 if(!['personal','podo'].includes(result.profile)||!result.data||!Array.isArray(result.data.transactions)||!result.capabilities?.finance)throw Error('Sessão inválida. Entre novamente.');
 const epoch=++sessionEpoch;unlocked=false;profile=result.profile;currentUsername=result.username||'';
 capabilities=Object.freeze({finance:true,clinic:profile==='podo'&&result.capabilities.clinic===true,admin:profile==='personal'&&currentUsername==='jefferson'&&result.capabilities.admin===true});
 if(profile==='personal'&&['clients','services','appointments','settings'].some(key=>Object.hasOwn(result.data,key)))throw Error('O servidor enviou dados incompatíveis com o perfil. Recarregue a página.');
 db=result.data;revision=result.revision;saveChain=Promise.resolve();saveFailed=false;passwordChangeProfile=null;clinicFeatures=null;clearManagementDashboard();
 if(!await mountAuthorizedViews(epoch))return;
 unlocked=true;document.body.classList.toggle('personal-mode',profile==='personal');$('authVeil').classList.add('hidden');clearAuthSecrets();
 const displayName=currentUsername?currentUsername.charAt(0).toUpperCase()+currentUsername.slice(1):'Usuário';$('headerGreeting').textContent='Olá, '+displayName;$('profileIcon').textContent=currentUsername.slice(0,2).toUpperCase()||'FF';$('headerEyebrow').textContent=capabilities.clinic?'GESTÃO DO CONSULTÓRIO':'SUAS FINANÇAS, SEUS PLANOS';renderNavigation();navigate(capabilities.clinic?'home':'pessoal');
}
async function authSubmit(){
 if(authBusy||!authReady)return;
 const username=$('authUsername').value.trim().toLowerCase(),password=$('authPassword').value,changing=passwordChangeProfile!==null;
 if(!username||!password||password.length>128){$('authFeedback').textContent='Informe usuário e senha.';return}
 if((changing||registrationMode)&&(password.length<10||password!==$('authPasswordConfirm').value)){$('authFeedback').textContent='Use de 10 a 128 caracteres e confirme a mesma senha.';return}
 let payload={username,password},action='login';
 if(changing){action='changePassword';payload={password}}
 else if(registrationMode){
  const initialProfile=username==='raquel'?'podo':username==='jefferson'?'personal':null;
  if(!initialProfile||!$('setupCode').value.trim()){$('authFeedback').textContent='Informe a conta inicial e o código de ativação do responsável.';return}
  action='register';payload={profile:initialProfile,password,setupCode:$('setupCode').value};
 }
 authBusy=true;updateAuthForm();$('authFeedback').textContent='Aguarde…';
 try{await startSession(await api(action,payload));$('authFeedback').textContent=''}catch(error){$('authFeedback').textContent=error.message}finally{authBusy=false;updateAuthForm()}
}
async function lockApp(){
 if(managementBusy||sessionClosing)return;
 sessionClosing=true;document.body.classList.add('session-closing');
 try{await saveChain;await api('logout')}catch(error){sessionClosing=false;document.body.classList.remove('session-closing');alert('Não foi possível encerrar a sessão: '+error.message);return}
 sessionEpoch++;unlocked=false;profile=null;currentUsername='';capabilities=Object.freeze({finance:false,clinic:false,admin:false});clinicFeatures=null;db=initial();revision=0;saveFailed=false;saveChain=Promise.resolve();passwordChangeProfile=null;registrationMode=false;
 closeModal();clearManagementDashboard();$('appContent').replaceChildren();$('mainNav').replaceChildren();$('mainNav').classList.add('hidden');$('headerGreeting').textContent='Bem-vindo';$('profileIcon').textContent='FF';document.body.classList.remove('dashboard-mode','personal-mode','session-closing');$('authUsername').value='';clearAuthSecrets();$('authVeil').classList.remove('hidden');$('authFeedback').textContent='';sessionClosing=false;updateAuthForm();
}
async function signOut(){if(saveFailed&&!confirm('Existem alterações não salvas. Deseja sair mesmo assim?'))return;await lockApp()}
function openPersonalAppointment(){if(requireClinic())openAppointment('',{type:'personal'})}
function cancelAppointment(id){if(requireClinic()&&confirm('Cancelar este agendamento?')){updateApStatus(id,'cancelado');closeModal()}}
function removeExpenseLine(node){node.parentElement.remove();updateExpenseTotal()}
function installEvents(){
 const publicActions=new Set(['authSubmit','initAuth','updateAuthForm','toggleAuthPassword','toggleRegistration','lockApp','closeModal','closeModalBackdrop']);
 const clinicalActions=new Set(['openService','saveService','deleteService','openClient','saveClient','deleteClient','openClientHistory','openCompleteAppointment','saveAppointmentCompletion','openAppointment','openPersonalAppointment','saveAppointment','toggleAppointmentType','appointmentServices','toggleAppointmentNotes','updateApStatus','appointmentActions','openWhatsApp','cancelAppointment','openFreeSlot','changeDate','renderAgenda','renderClients','saveSettings']);
 const adminActions=new Set(['openManagementDashboard','loadManagementDashboard','renderManagementDashboard','saveDashboardSettings','dashboardOpenRecurring','dashboardSaveRecurring','dashboardOpenService','dashboardSaveService','dashboardDeleteService']);
 const actions={authSubmit,initAuth,updateAuthForm,toggleAuthPassword,toggleRegistration,lockApp,closeModal,closeModalBackdrop,signOut,navigate,openIncome,saveIncome,openExpense,saveExpense,deleteTransaction,renderPersonal,renderFinance,renderReservePage,openFinanceExpenses,financeOpenBalance,financeSaveBalance,financeOpenPayment,financeSavePayment,financeCancelBill,financeOpenPlan,financeSavePlan,financeUpdatePlanMode,financeOpenBill,financeSaveBill,financeChangeBillsMonth,financeOpenRecurring,financeSaveRecurring,financeUpdateRecurringType,financeSettingsMonthChanged,addExpenseLine,removeExpenseLine,updateExpenseTotal,updateExpensePayment,updateExpensePaymentPreview,syncExpensePurchaseDate,suggestExpenseCategory,openService,saveService,deleteService,openClient,saveClient,deleteClient,openClientHistory,openCompleteAppointment,saveAppointmentCompletion,openAppointment,openPersonalAppointment,saveAppointment,toggleAppointmentType,appointmentServices,toggleAppointmentNotes,updateApStatus,appointmentActions,openWhatsApp,cancelAppointment,openFreeSlot,changeDate,renderAgenda,renderClients,saveSettings,openManagementDashboard,loadManagementDashboard,renderManagementDashboard,saveDashboardSettings,dashboardOpenRecurring,dashboardSaveRecurring,dashboardOpenService,dashboardSaveService,dashboardDeleteService};
 installActionEvents({document,actions,allow:name=>!sessionClosing&&(publicActions.has(name)||unlocked&&(clinicalActions.has(name)?requireClinic():adminActions.has(name)?capabilities.admin:capabilities.finance)),onError:error=>{console.error('UI action failed',error);alert(error.message||'Não foi possível concluir.')}});
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&$('modalBack').classList.contains('show')){event.preventDefault();closeModal()}});
}

installEvents();
initAuth();
