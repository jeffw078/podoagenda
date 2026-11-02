function financeCreditWarningsHtml(warnings){
 return warnings.map(warning=>'<p class="notice warn" role="status">'+esc(financeCardName(warning.cardId))+' · '+esc(financeMonthLabel(warning.month))+': limite de '+esc(money(warning.limit))+' excedido em '+esc(money(warning.excess))+'. Total previsto: '+esc(money(warning.projected))+'.</p>').join('');
}
function financeCategoriesHtml(month,insight=FinanceInsights.overview(db,month,dateToday)){
 const categories=[...insight.categories].sort((a,b)=>b.amount-a.amount),maximum=Math.max(...categories.map(item=>item.amount),1);
 const categoryBar=item=>'<button type="button" class="insight-bar-row finance-category-button" onclick="financeOpenCategory('+financeArgument(month)+','+financeArgument(item.category)+')" aria-haspopup="dialog" aria-label="Ver gastos de '+esc(item.category)+', '+esc(money(item.amount))+'"><span class="flex"><span>'+esc(item.category)+'</span><strong>'+esc(money(item.amount))+'</strong></span><span class="insight-bar-track"><span class="insight-bar category" style="width:'+Math.max(0,Math.min(100,item.amount/maximum*100))+'%"></span></span></button>';
 return '<section class="card finance-category-card"><h3>Gastos por categoria</h3>'+(categories.length?'<p class="footer-note">Toque em uma categoria para ver os gastos.</p>'+categories.map(categoryBar).join(''):'<p class="empty">Nenhum gasto registrado neste mês.</p>')+'<p class="footer-note">Inclui parcelas do crédito no mês da fatura, sem contar novamente o pagamento do cartão. A reserva fica separada.</p></section>';
}
function financeIndicatorsHtml(month,middleCard=''){
 const insight=FinanceInsights.overview(db,month,dateToday),forecast=insight.forecast,reserve=insight.reserve;
 const maximum=Math.max(forecast.income,forecast.outflows,1);
 const bar=(label,value,color,max)=>'<div class="insight-bar-row"><div class="flex"><span>'+esc(label)+'</span><strong>'+esc(money(value))+'</strong></div><div class="insight-bar-track"><div class="insight-bar '+color+'" style="width:'+Math.max(0,Math.min(100,value/max*100))+'%"></div></div></div>';
 const incomeLabel=forecast.incomeRecorded?'Entradas reais':'Entradas previstas';
 const incomeNote=forecast.incomeRecorded?'A comparação usa a soma de todas as entradas lançadas no mês.':'A comparação usa a renda planejada enquanto não houver entradas lançadas no mês.';
 const forecastCard='<section class="card"><h3>Previsão de entradas e saídas</h3><p class="footer-note">'+esc(financeMonthLabel(month))+'</p><div role="img" aria-label="'+incomeLabel+' '+esc(money(forecast.income))+'; saídas previstas '+esc(money(forecast.outflows))+'">'+bar(incomeLabel,forecast.income,'income',maximum)+bar('Saídas previstas',forecast.outflows,'outflow',maximum)+'</div><div class="insight-result '+(forecast.gap<0?'negative':'positive')+'">'+(forecast.shortfall>0?'Vai faltar '+esc(money(forecast.shortfall)):'Sobra prevista de '+esc(money(forecast.gap)))+'</div><p class="footer-note">'+incomeNote+' Inclui gastos, contas e reserva do mês. O saldo inicial fica fora desta comparação.</p>'+(forecast.unknown?'<p class="notice warn">'+forecast.unknown+' conta(s) ainda sem valor previsto.</p>':'')+'</section>';
 const reserveCard='<section class="card"><h3>Meta acumulada da reserva</h3><p class="footer-note">Até '+esc(financeMonthLabel(reserve.throughMonth))+'</p><div class="reserve-progress" role="progressbar" aria-label="Meta acumulada da reserva" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+(reserve.percentage||0)+'"><div style="width:'+(reserve.percentage||0)+'%"></div></div><dl class="finance-summary"><div><dt>Valor juntado</dt><dd>'+esc(money(reserve.saved))+'</dd></div><div><dt>Metas somadas</dt><dd>'+esc(money(reserve.target))+'</dd></div><div><dt>Juntado − meta</dt><dd class="'+(reserve.difference<0?'negative':'positive')+'">'+esc(money(reserve.difference))+'</dd></div></dl><p class="footer-note">As metas são definidas nas configurações e lançadas como contas mensais da reserva.</p></section>';
 return '<div class="finance-insights">'+forecastCard+(middleCard||financeCategoriesHtml(month,insight))+reserveCard+'</div>'+financeCreditWarningsHtml(FinanceInsights.cardWarnings(db).filter(warning=>warning.month===month));
}
function financeOpenCategory(month,category){
 const insight=FinanceInsights.overview(db,month,dateToday);
 const expenses=insight.categoryExpenses.filter(item=>item.category===category).sort((a,b)=>(b.purchaseDate||b.date).localeCompare(a.purchaseDate||a.date));
 const total=insight.categories.find(item=>item.category===category)?.amount||0;
 const methods={pix:'Pix',debit:'Débito',cash:'Dinheiro',transfer:'Transferência',other:'Outra forma de pagamento'};
 const rows=expenses.map(item=>{
  const detail=item.source==='credit'
   ? financeCardName(item.cardId)+' · Compra em '+financeDateLabel(item.purchaseDate||item.date)+(item.installmentCount>1?' · Parcela '+item.installmentNumber+'/'+item.installmentCount:'')+' · Fatura de '+financeMonthLabel(month)
   : financeDateLabel(item.date)+' · '+(methods[item.method]||item.method||'Pagamento com saldo');
  return '<article class="finance-transaction"><div><strong>'+esc(item.description)+'</strong><small>'+esc(detail)+'</small></div><strong>'+esc(money(item.amount))+'</strong></article>';
 }).join('');
 modal('Gastos de '+category,'<div class="notice"><strong>Total: '+esc(money(total))+'</strong><br>'+esc(financeMonthLabel(month))+' · '+expenses.length+' '+(expenses.length===1?'lançamento':'lançamentos')+'</div>'+(rows||'<p class="empty">Nenhum gasto nesta categoria no mês selecionado.</p>'));
}
function financeCardLimitsForm(month){
 const limits=FinanceCore.ensure(db).cardLimits||[];
 return '<section class="card"><h3>Limite de uso do cartão no mês</h3><p class="footer-note">'+esc(financeMonthLabel(month))+'. O limite avisa quando as parcelas e os valores previstos ultrapassarem o orçamento. Deixe vazio para não definir limite.</p><form class="fields" onsubmit="event.preventDefault();financeSaveCardLimits('+financeArgument(month)+')"><div class="fields two">'+['nubank','mercado_pago'].map(cardId=>financeInput(financeCardName(cardId)+' (R$)','cardLimit_'+cardId,'number',limits.find(limit=>limit.month===month&&limit.cardId===cardId)?.amount??'','min="0" step="0.01"')).join('')+'</div><button type="submit" class="btn full">Salvar limites do mês</button></form></section>';
}
function financeSaveCardLimits(month){
 financeMutate(()=>{
  const staged=structuredClone(db);
  for(const cardId of ['nubank','mercado_pago']){
   const raw=$('cardLimit_'+cardId).value.trim();
   if(!raw){if(staged.finance?.cardLimits)staged.finance.cardLimits=staged.finance.cardLimits.filter(limit=>limit.month!==month||limit.cardId!==cardId);continue;}
   FinanceInsights.setCardLimit(staged,month,cardId,Number(raw.replace(',','.')));
  }
  db.finance=staged.finance;
 });
}
function financeReserveRecurringHtml(month){
 const bill=FinanceCore.ensure(db).bills.find(item=>item.month===month&&item.source==='reserve');
 if(!bill)return '';
 return '<article class="finance-recurring"><div><strong>Reserva mensal</strong><small>Conta fixa do planejamento · '+esc(financeDateLabel(bill.dueDate))+'</small></div><div><strong>'+esc(money(bill.expectedAmount||0))+'</strong>'+financeStatus(bill)+'</div></article>';
}
