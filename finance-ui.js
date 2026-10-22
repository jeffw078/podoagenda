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
    ${bill.status === 'pending' ? `<div class="actions finance-bill-actions"><button type="button" class="btn small" onclick="financeOpenPayment(${financeArgument(bill.id)})" aria-label="Pagar ${esc(bill.description)}">Pagar</button>${compact ? '' : `<button type="button" class="btn outline small" onclick="financeCancelBill(${financeArgument(bill.id)})" aria-label="Cancelar ${esc(bill.description)}">Cancelar</button>`}</div>` : ''}
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
  ${financeIndicatorsHtml(month)}
  <div class="finance-columns"><section class="card"><div class="finance-heading"><h3>Visão de ${esc(financeMonthLabel(month))}</h3></div>
    <dl class="finance-summary"><div><dt>Renda mensal prevista</dt><dd>${plan ? esc(money(plan.expectedIncome)) : 'Não informada'}</dd></div><div><dt>Entradas lançadas</dt><dd>${esc(money(summary.income))}</dd></div><div><dt>Contas pagas</dt><dd>${esc(money(summary.billsPaid))}</dd></div><div><dt>Disponível após as contas previstas</dt><dd>${esc(money(summary.freeAfterBills))}</dd></div></dl>${unknown ? '<p class="notice warn">Existem contas sem valor previsto. O disponível após as contas ainda pode mudar.</p>' : ''}
    ${!db.finance.openingBalance ? '<button type="button" class="btn secondary full" onclick="financeOpenBalance()">Cadastrar meu saldo atual</button>' : ''}
  </section><section class="card"><div class="finance-heading"><h3>Contas do mês</h3><button class="btn outline small" onclick="openFinanceExpenses('bills')">Ver / adicionar</button></div>${financeBillRows(bills, true)}</section></div>${financeCreditPurchasesHtml(month)}
  <section class="card"><h3>Movimentações do mês</h3>${transactions.length ? transactions.map(t => `<div class="finance-transaction"><div><strong>${esc(t.description || t.category || 'Lançamento')}</strong><small>${financeDateLabel(t.date)} · ${esc(t.financeKind === 'reserve' ? 'Reserva' : t.financeKind === 'bill' ? 'Conta paga' : t.category || 'Movimentação')}</small></div><strong class="${t.type === 'income' ? 'positive' : 'negative'}">${t.type === 'income' ? '+' : '−'} ${esc(money(t.amount))}</strong></div>`).join('') : '<p class="empty">Sem movimentações neste mês.</p>'}</section>`;
}

function openFinanceExpenses(tab = 'spending', preserveMonth = false) {
  const spending = tab === 'spending' || tab === 'gastos';
  const month = (preserveMonth && financeBillsSelectedMonth) || financeMonth(profile === 'personal' ? 'personalMonth' : 'financeMonth');
  financeBillsSelectedMonth = month;
  const tabs = `<div class="tabs finance-tabs" aria-label="Tipo de despesa"><button type="button" class="${spending ? 'selected' : ''}" aria-pressed="${spending}" onclick="openFinanceExpenses('spending',true)">Gastos diários</button><button type="button" class="${spending ? '' : 'selected'}" aria-pressed="${!spending}" onclick="openFinanceExpenses('bills',true)">Contas do mês</button></div>`;
  if (spending) {
    modal('Gastos diários e contas do mês', tabs + '<p class="footer-note">Registre compras e seus itens. No crédito, escolha o cartão e o mês de cada fatura.</p>' + renderSpendingForm()+financeCreditPurchasesHtml(month));
    showSpendingFields();
    return;
  }
  const bills = financeSync(month);
  modal('Gastos diários e contas do mês', tabs + `<div class="finance-heading">${financeInput('Mês das contas', 'financeBillsMonth', 'month', month, 'required onchange="financeChangeBillsMonth()"')}</div><p class="footer-note">Ao pagar, informe o valor real; a previsão fica preservada. Configure novas contas em recorrências.</p><div class="card">${financeBillRows(bills)}</div><button type="button" class="btn outline full" onclick="financeOpenRecurring()">+ Conta recorrente</button>`);
}
function financeChangeBillsMonth() { financeBillsSelectedMonth = financeMonth('financeBillsMonth'); openFinanceExpenses('bills', true); }
function financeCategories(selected = '') {
  return [...new Set([...expenseCategories, 'Reserva', selected].filter(Boolean))].map(category => `<option value="${esc(category)}" ${category === selected ? 'selected' : ''}>${esc(category)}</option>`).join('');
}
function financeOpenPayment(id) {
  const bill = FinanceCore.ensure(db).bills.find(item => item.id === id);
  if (!bill || bill.status !== 'pending') return financeError(Error('Esta conta não está pendente.'));
  modal('Pagar conta', `<form class="fields" onsubmit="event.preventDefault();financeSavePayment(${financeArgument(id)})"><div class="notice"><strong>${esc(bill.description)}</strong><br>Previsto: ${bill.expectedAmount == null ? 'Sem previsão' : esc(money(bill.expectedAmount))} · Vencimento: ${financeDateLabel(bill.dueDate)}</div>
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
  return `<form class="fields" onsubmit="event.preventDefault();financeSavePlan(${financeArgument(month)},${financeArgument(scope)})"><p class="footer-note">Planejamento de ${esc(financeMonthLabel(month))}. A renda prevista serve para calcular a meta; não cria uma entrada.</p>${financeInput('Renda mensal prevista (R$)', id('financePlanIncome'), 'number', plan.expectedIncome, 'required min="0" step="0.01"')}
    <div class="fields two"><label class="field">Como reservar<select id="${id('financePlanMode')}" onchange="financeUpdatePlanMode(${financeArgument(scope)})"><option value="amount" ${plan.reserveMode === 'amount' ? 'selected' : ''}>Valor fixo em reais</option><option value="percentage" ${plan.reserveMode === 'percentage' ? 'selected' : ''}>Percentual da renda prevista</option></select></label><label class="field"><span id="${id('financePlanValueLabel')}">${plan.reserveMode === 'percentage' ? 'Percentual da reserva (%)' : 'Valor da reserva (R$)'}</span><input id="${id('financePlanValue')}" type="number" min="0" ${plan.reserveMode === 'percentage' ? 'max="100"' : ''} step="0.01" value="${esc(plan.reserveValue)}" required></label></div>
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
  const reserveTransactions = (db.transactions || []).filter(t => t.financeKind === 'reserve' && t.date?.slice(0, 7) === month).sort((a, b) => b.date.localeCompare(a.date));
  target.innerHTML = `<div class="finance-kpis finance-kpis-three">${financeKpi('Reservado no mês', summary.reserved, 'Valor efetivamente lançado e pago.')}</div><section class="card"><h3>Histórico da reserva em ${esc(financeMonthLabel(month))}</h3>${reserveTransactions.length ? reserveTransactions.map(t => `<div class="finance-transaction"><div><strong>${esc(t.description || 'Reserva')}</strong><small>${financeDateLabel(t.date)} · Reserva</small></div><strong class="negative">− ${esc(money(t.amount))}</strong></div>`).join('') : '<p class="empty">Nenhuma reserva lançada neste mês.</p>'}${bills.length ? `<h3>Contas de reserva do mês</h3>${financeBillRows(bills)}</section>` : '</section>'}`;
}

function financeOpenBalance() {
  const finance = FinanceCore.ensure(db);
  const hasOpening = !!finance.openingBalance;
  modal(hasOpening ? 'Corrigir saldo atual' : 'Cadastrar saldo atual', `<form class="fields" onsubmit="event.preventDefault();financeSaveBalance()"><div class="notice">${hasOpening ? 'A correção fica no histórico com o motivo informado. Não é uma receita ou despesa.' : 'Informe seu saldo na data escolhida. Os lançamentos já contabilizados nessa data formam a base inicial.'}</div>${financeInput('Saldo na data (R$)', 'financeBalanceAmount', 'number', hasOpening ? FinanceCore.currentBalance(db, dateToday) : '', 'required step="0.01"')}${financeInput('Data da conferência', 'financeBalanceDate', 'date', dateToday, 'required max="' + dateToday + '"')}${financeInput(hasOpening ? 'Motivo da correção (obrigatório)' : 'Observação (opcional)', 'financeBalanceReason', 'text', '', `${hasOpening ? 'required' : ''} maxlength="500"`)}<button type="submit" class="btn full">${hasOpening ? 'Registrar correção' : 'Cadastrar saldo inicial'}</button></form>`);
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
  const amountFields = card ? '<p class="footer-note">O valor da fatura vem das compras e parcelas do cartão. Ajuste aqui somente o cadastro e o vencimento.</p>' : `<div class="fields two"><label class="field">Tipo de conta<select id="financeRecurringType" onchange="financeUpdateRecurringType()"><option value="fixed" ${rule.fixed ? 'selected' : ''}>Fixa</option><option value="variable" ${rule.fixed ? '' : 'selected'}>Variável</option></select></label>${financeInput('Valor previsto (R$)', 'financeRecurringAmount', 'number', rule.expectedAmount ?? '', `${rule.fixed ? 'required' : ''} min="0" step="0.01" placeholder="Sem previsão"`)}</div><p class="footer-note">Contas fixas exigem valor. Em contas variáveis, deixe vazio se ainda não conhecer a previsão.</p>`;
  modal(id ? 'Editar conta recorrente' : 'Nova conta recorrente', `<form class="fields" onsubmit="event.preventDefault();financeSaveRecurring(${financeArgument(id)})">${financeInput('Descrição', 'financeRecurringDescription', 'text', rule.description, 'required maxlength="180"')}<label class="field">Categoria<select id="financeRecurringCategory">${financeCategories(rule.category)}</select></label>${amountFields}<div class="fields two">${financeInput('Dia do vencimento', 'financeRecurringDue', 'number', rule.dueDay, 'required min="1" max="31" step="1"')}<label class="field">Situação<select id="financeRecurringActive"><option value="true" ${rule.active ? 'selected' : ''}>Ativa</option><option value="false" ${rule.active ? '' : 'selected'}>Inativa</option></select></label></div><div class="fields two">${financeInput('Mês de início', 'financeRecurringStart', 'month', rule.startMonth, 'required')}${financeInput('Mês final (opcional)', 'financeRecurringEnd', 'month', rule.endMonth || '')}</div><p class="footer-note">Uma conta é gerada por mês. Alterações preservam contas já pagas.</p><button type="submit" class="btn full">Salvar recorrência</button></form>`);
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
  target.innerHTML = `<section class="card"><div class="finance-heading"><h3>Planejamento financeiro</h3>${financeInput('Mês', 'financeSettingsMonth', 'month', month, 'required onchange="financeSettingsMonthChanged()"')}</div>${financePlanForm(month, 'settings')}</section>
    ${financeCardLimitsForm(month)}<section class="card"><div class="finance-heading"><h3>Contas recorrentes</h3><button type="button" class="btn small" onclick="financeOpenRecurring()">+ Recorrência</button></div>${finance.recurringBills.length ? finance.recurringBills.map(rule => `<article class="finance-recurring"><div><strong>${esc(rule.description)}</strong><small>${esc(rule.category)} · ${rule.fixed ? 'Fixa' : 'Variável'} · Dia ${rule.dueDay}</small><small>${esc(financeMonthLabel(rule.startMonth))}${rule.endMonth ? ' até ' + esc(financeMonthLabel(rule.endMonth)) : ' em diante'}</small></div><div><strong>${rule.cardId ? 'Fatura automática' : rule.expectedAmount == null ? 'Sem previsão' : esc(money(rule.expectedAmount))}</strong><span class="pill ${rule.active ? 'green' : 'gray'}">${rule.active ? 'Ativa' : 'Inativa'}</span><button type="button" class="btn outline small" onclick="financeOpenRecurring(${financeArgument(rule.id)})" aria-label="Editar ${esc(rule.description)}">Editar</button></div></article>`).join('') : '<p class="empty">Cadastre contas fixas e variáveis para organizar os próximos meses.</p>'}${financeReserveRecurringHtml(month)}</section>
    <section class="card"><div class="finance-heading"><h3>Saldo atual e histórico</h3><button type="button" class="btn outline small" onclick="financeOpenBalance()">${finance.openingBalance ? 'Conferir / corrigir' : 'Cadastrar saldo'}</button></div><div class="finance-balance-value">${esc(money(FinanceCore.currentBalance(db, dateToday)))}</div><p class="footer-note">Saldo cadastrado atualizado pelos lançamentos até ${financeDateLabel(dateToday)}.</p>${finance.openingBalance ? `<div class="finance-audit"><strong>Ponto inicial · ${financeDateLabel(finance.openingBalance.date)}</strong><span>${esc(money(finance.openingBalance.amount))}</span></div>` : '<p class="notice">O saldo inicial ainda não foi cadastrado.</p>'}${[...finance.adjustments].reverse().map(adjustment => `<article class="finance-audit"><div><strong>${financeDateLabel(adjustment.date)} · ${esc(adjustment.reason)}</strong><small>${esc(money(adjustment.before))} → ${esc(money(adjustment.after))}</small></div><span>${adjustment.delta >= 0 ? '+' : '−'} ${esc(money(Math.abs(adjustment.delta)))}</span></article>`).join('')}<p class="footer-note">O ponto inicial e as correções anteriores são preservados. Corrigir saldo exige um motivo e não cria receita ou despesa.</p></section>`;
}
