// Clinical actions use the live, authorized account document supplied by the app.
export function createClinicFeatures(ctx){
 const {$,esc,uid,modal,field,formHtml,persist,closeModal,renderAll,clientHistoryHtml}=ctx;
 const authorized=()=>ctx.requireClinic()===true;
 const notify=message=>(ctx.alert||globalThis.alert)(message);
 const normalize=client=>{
  const value=client?.anamnesis||{};
  return{diabetes:['none','type1','type2'].includes(value.diabetes)?value.diabetes:'none',hypertension:value.hypertension===true,circulationProblems:value.circulationProblems===true,anticoagulants:value.anticoagulants===true,allergies:typeof value.allergies==='string'?value.allergies:''};
 };
 function openClient(id){
  if(!authorized())return;
  const client=ctx.db.clients.find(item=>item.id===id),record=normalize(client);
  const check=(name,id,key)=>`<label class="service-check"><input type="checkbox" id="${id}" ${record[key]?'checked':''}><span>${name}</span></label>`;
  const anamnesis='<fieldset class="fields"><legend>Anamnese</legend><p class="footer-note">Registre as informações relatadas pela cliente.</p><label class="field">Diabetes<select id="cDiabetes"><option value="none" '+(record.diabetes==='none'?'selected':'')+'>Não informada</option><option value="type1" '+(record.diabetes==='type1'?'selected':'')+'>Tipo 1</option><option value="type2" '+(record.diabetes==='type2'?'selected':'')+'>Tipo 2</option></select></label>'+check('Hipertensão','cHypertension','hypertension')+check('Problemas de circulação','cCirculationProblems','circulationProblems')+check('Uso de anticoagulantes','cAnticoagulants','anticoagulants')+'<label class="field">Alergias a medicamentos/iodo (opcional)<textarea id="cAllergies" rows="3" maxlength="2000">'+esc(record.allergies)+'</textarea></label></fieldset>';
  modal(client?'Cadastro da cliente':'Nova cliente',formHtml(field('Nome completo','cName','text',client?.name||'')+field('WhatsApp / telefone','cPhone','tel',client?.phone||'',true,'inputmode="tel" placeholder="(47) 99999-9999"')+'<label class="field">Observações (opcional)<textarea id="cNotes" rows="2">'+esc(client?.notes||'')+'</textarea></label>'+anamnesis,`saveClient(${JSON.stringify(id||'')})`)+(client?'<div class="divider"></div>'+clientHistoryHtml(client.id):''));
 }
 function saveClient(id){
  if(!authorized())return;
  const name=$('cName').value.trim(),phone=$('cPhone').value.replace(/\D/g,''),notes=$('cNotes').value.trim();
  if(!name||phone.length<10||phone.length>13)return notify('Informe nome e telefone com DDD.');
  const diabetes=$('cDiabetes').value,allergies=$('cAllergies').value.trim();
  if(!['none','type1','type2'].includes(diabetes))return notify('Selecione uma opção válida para diabetes.');
  if(allergies.length>2000)return notify('As alergias devem ter até 2.000 caracteres.');
  const anamnesis={diabetes,hypertension:$('cHypertension').checked===true,circulationProblems:$('cCirculationProblems').checked===true,anticoagulants:$('cAnticoagulants').checked===true,allergies};
  const client=ctx.db.clients.find(item=>item.id===id);
  if(client)Object.assign(client,{name,phone,notes,anamnesis});else ctx.db.clients.push({id:uid(),name,phone,notes,anamnesis});
  persist();closeModal();renderAll();
 }
 function riskBadge(client){
  if(!authorized())return '';
  const record=normalize(client),labels=[];
  if(record.diabetes==='type1')labels.push('⚠️ Paciente Diabético (Risco Clínico) · Diabetes tipo 1');
  if(record.diabetes==='type2')labels.push('⚠️ Paciente Diabético (Risco Clínico) · Diabetes tipo 2');
  if(record.hypertension)labels.push('⚠️ Hipertensão (Risco Clínico)');
  return labels.map(label=>'<span class="pill red" title="Informação registrada na anamnese">'+esc(label)+'</span>').join(' ');
 }
 function whatsappUrl(client,appointment){
  if(!authorized()||!client||!appointment||appointment.type==='personal')return '';
  const digits=String(client.phone||'').replace(/\D/g,'');
  const phone=digits.length===10||digits.length===11?'55'+digits:/^55\d{10,11}$/.test(digits)?digits:'';
  if(!phone||!/^\d{4}-\d{2}-\d{2}$/.test(appointment.date||'')||!/^\d{2}:\d{2}$/.test(appointment.time||''))return '';
  const [year,month,day]=appointment.date.split('-');
  const message=`Olá ${client.name}, confirmamos seu horário de Podologia em ${day}/${month}/${year} às ${appointment.time}. Favor confirmar presença.`;
  return 'https://wa.me/'+phone+'?text='+encodeURIComponent(message);
 }
 function openWhatsApp(id){
  if(!authorized())return;
  const appointment=ctx.db.appointments.find(item=>item.id===id);
  const client=ctx.db.clients.find(item=>item.id===appointment?.clientId),url=whatsappUrl(client,appointment);
  if(!url)return notify('Cadastre um telefone com DDD para enviar a confirmação.');
  if(ctx.openWindow)ctx.openWindow(url,'_blank','noopener,noreferrer');else globalThis.open(url,'_blank','noopener,noreferrer');
 }
 return{openClient,saveClient,riskBadge,whatsappUrl,openWhatsApp};
}
