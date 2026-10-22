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
 '<form class="card fields" onsubmit="event.preventDefault();saveDashboardSettings(\''+account.profile+'\')"><h3>Configurações deste ambiente</h3><p class="footer-note">Os valores abaixo são salvos somente neste ambiente.</p>'+
 dashboardInput(finance.openingBalance?'Saldo disponível para conferir (R$)':'Cadastrar saldo atual (R$)',p+'_balance','number',finance.openingBalance?summary.balance:'','step="0.01" placeholder="Informe o saldo atual"')+
 dashboardInput('Motivo da correção do saldo',p+'_reason','text','','maxlength="500" placeholder="Obrigatório ao corrigir um saldo já cadastrado"')+
 '<div class="divider"></div><h3>Planejamento de '+esc(month.split('-').reverse().join('/'))+'</h3>'+dashboardInput('Renda prevista do mês (R$)',p+'_income','number',plan.expectedIncome,'min="0" step="0.01" required')+
 '<div class="fields two"><label class="field">Meta da reserva<select id="'+p+'_mode"><option value="amount" '+(plan.reserveMode==='amount'?'selected':'')+'>Valor fixo em reais</option><option value="percentage" '+(plan.reserveMode==='percentage'?'selected':'')+'>Percentual da renda prevista</option></select></label>'+dashboardInput('Valor ou percentual',p+'_reserve','number',plan.reserveValue,'min="0" step="0.01" required')+'</div>'+dashboardInput('Dia de vencimento da reserva',p+'_day','number',plan.reserveDueDay,'min="1" max="31" step="1" required')+
 (studio?'<div class="divider"></div><h3>Jornada da agenda</h3><div class="fields two">'+dashboardInput('Início',p+'_start','time',schedule.start,'required')+dashboardInput('Fim',p+'_end','time',schedule.end,'required')+'</div><div class="fields two">'+dashboardInput('Início do almoço',p+'_lunch','time',schedule.lunch,'required')+dashboardInput('Almoço (minutos)',p+'_lunchDuration','number',schedule.lunchDuration,'min="60" max="240" step="1" required')+'</div>':'')+
 '<button class="btn full" type="submit">Salvar configurações</button></form>'+
 '<div class="card"><div class="flex"><h3>Contas recorrentes</h3><button class="btn secondary small" onclick="dashboardOpenRecurring(\''+account.profile+'\')">+ Recorrência</button></div>'+(finance.recurringBills.map((rule,index)=>'<div class="item"><div><b>'+esc(rule.description)+'</b><small>'+(rule.fixed?'Fixa':'Variável')+' · '+(rule.cardId?'Fatura automática':rule.expectedAmount===null?'Valor a definir':money(rule.expectedAmount))+' · dia '+rule.dueDay+' · '+(rule.active?'Ativa':'Pausada')+'</small></div><button class="btn outline small" onclick="dashboardOpenRecurring(\''+account.profile+'\','+index+')">Editar</button></div>').join('')||'<p class="muted">Nenhuma recorrência cadastrada.</p>')+'</div>'+
 (studio?'<div class="card"><div class="flex"><h3>Serviços</h3><button class="btn secondary small" onclick="dashboardOpenService()">+ Serviço</button></div>'+catalog.map((service,index)=>service.archived?'':'<div class="item"><div><b>'+esc(service.name)+'</b><small>'+service.duration+' min · '+money(service.price)+'</small></div><button class="btn outline small" onclick="dashboardOpenService('+index+')">Editar</button><button class="btn danger small" onclick="dashboardDeleteService('+index+')">Excluir</button></div>').join('')+'</div>':'')+
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
 const html='<form class="fields" onsubmit="event.preventDefault();dashboardSaveRecurring(\''+target+'\','+index+')">'+dashboardInput('Descrição','dashRuleName','text',rule?.description||'','maxlength="120" required')+dashboardInput('Categoria','dashRuleCategory','text',rule?.category||'Outros','maxlength="120" required')+(card?'<p class="footer-note">O valor da fatura vem das compras e parcelas do cartão. Ajuste aqui somente o cadastro e o vencimento.</p>':('<label class="field">Tipo<select id="dashRuleType"><option value="fixed" '+(rule?.fixed?'selected':'')+'>Valor fixo</option><option value="variable" '+(!rule?.fixed?'selected':'')+'>Valor variável</option></select></label>'+dashboardInput('Valor previsto (R$) · opcional para variável','dashRuleAmount','number',rule?.expectedAmount??'','min="0" step="0.01"')))+dashboardInput('Dia de vencimento','dashRuleDay','number',rule?.dueDay||10,'min="1" max="31" required')+'<div class="fields two">'+dashboardInput('Primeiro mês','dashRuleStart','month',rule?.startMonth||month,'required')+dashboardInput('Último mês (opcional)','dashRuleEnd','month',rule?.endMonth||'')+'</div><label class="field">Situação<select id="dashRuleActive"><option value="true" '+(rule?.active!==false?'selected':'')+'>Ativa</option><option value="false" '+(rule?.active===false?'selected':'')+'>Pausada</option></select></label><button class="btn full" type="submit">Salvar recorrência</button></form>';
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
 modal('Serviço do consultório','<form class="fields" onsubmit="event.preventDefault();dashboardSaveService('+index+')">'+dashboardInput('Serviço','dashServiceName','text',service?.name||'','maxlength="120" required')+dashboardInput('Duração (minutos)','dashServiceDuration','number',service?.duration||60,'min="5" max="1440" step="1" required')+dashboardInput('Valor (R$)','dashServicePrice','number',service?.price??'','min="0" step="0.01" required')+'<button class="btn full" type="submit">Salvar serviço</button></form>');
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
