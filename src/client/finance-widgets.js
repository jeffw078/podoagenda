function financeCreditWarningsHtml(warnings){
 return warnings.map(warning=>'<p class="notice warn" role="status">'+esc(financeCardName(warning.cardId))+' · '+esc(financeMonthLabel(warning.month))+': limite de '+esc(money(warning.limit))+' excedido em '+esc(money(warning.excess))+'. Total previsto: '+esc(money(warning.projected))+'.</p>').join('');
}
function financeIndicatorsHtml(month){
 const insight=FinanceInsights.overview(db,month,dateToday),forecast=insight.forecast,reserve=insight.reserve;
 const maximum=Math.max(forecast.income,forecast.outflows,1),categories=[...insight.categories].sort((a,b)=>b.amount-a.amount),categoryMax=Math.max(...categories.map(item=>item.amount),1);
 const bar=(label,value,color,max)=>'<div class="insight-bar-row"><div class="flex"><span>'+esc(label)+'</span><strong>'+esc(money(value))+'</strong></div><div class="insight-bar-track"><div class="insight-bar '+color+'" style="width:'+Math.max(0,Math.min(100,value/max*100))+'%"></div></div></div>';
 return '<div class="finance-insights"><section class="card"><h3>Previsão de entradas e saídas</h3><p class="footer-note">'+esc(financeMonthLabel(month))+'</p><div role="img" aria-label="Entradas previstas '+esc(money(forecast.income))+'; saídas previstas '+esc(money(forecast.outflows))+'">'+bar('Entradas previstas',forecast.income,'income',maximum)+bar('Saídas previstas',forecast.outflows,'outflow',maximum)+'</div><div class="insight-result '+(forecast.gap<0?'negative':'positive')+'">'+(forecast.shortfall>0?'Vai faltar '+esc(money(forecast.shortfall)):'Sobra prevista de '+esc(money(forecast.gap)))+'</div><p class="footer-note">A previsão compara a renda planejada ou já recebida com gastos, contas e reserva do mês. O saldo inicial fica fora desta comparação.</p>'+(forecast.unknown?'<p class="notice warn">'+forecast.unknown+' conta(s) ainda sem valor previsto.</p>':'')+'</section><section class="card"><h3>Gastos por categoria</h3>'+(categories.length?categories.map(item=>bar(item.category,item.amount,'category',categoryMax)).join(''):'<p class="empty">Nenhum gasto registrado neste mês.</p>')+'<p class="footer-note">Inclui parcelas do crédito no mês da fatura, sem contar novamente o pagamento do cartão. A reserva fica separada.</p></section><section class="card"><h3>Meta acumulada da reserva</h3><p class="footer-note">Até '+esc(financeMonthLabel(reserve.throughMonth))+'</p><div class="reserve-progress" role="progressbar" aria-label="Meta acumulada da reserva" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+(reserve.percentage||0)+'"><div style="width:'+(reserve.percentage||0)+'%"></div></div><dl class="finance-summary"><div><dt>Valor juntado</dt><dd>'+esc(money(reserve.saved))+'</dd></div><div><dt>Metas somadas</dt><dd>'+esc(money(reserve.target))+'</dd></div><div><dt>Juntado − meta</dt><dd class="'+(reserve.difference<0?'negative':'positive')+'">'+esc(money(reserve.difference))+'</dd></div></dl><p class="footer-note">As metas são definidas nas configurações e lançadas como contas mensais da reserva.</p></section></div>'+financeCreditWarningsHtml(FinanceInsights.cardWarnings(db).filter(warning=>warning.month===month));
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
