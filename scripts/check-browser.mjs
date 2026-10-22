import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {accountView} from '../lib/passwords.js';
import {adminAccountView,hasClinicalWrite,mergeFinancialData} from '../lib/access-control.js';
import '../finance-core.js';

const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const deploymentConfig=JSON.parse(await readFile(path.join(root,'vercel.json'),'utf8'));
const productionHeaders=deploymentConfig.headers.find(rule=>rule.source==='/(.*)')?.headers||[];
assert.ok(productionHeaders.some(header=>header.key.toLowerCase()==='content-security-policy'&&header.value.includes("script-src 'self'")), 'Browser server must enforce the deployed script policy');
const browserPath=[process.env.BROWSER_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(file=>file&&existsSync(file));
if(!browserPath){console.log('Browser check skipped: set BROWSER_PATH to Chromium/Edge.');process.exit(0)}
const clone=value=>JSON.parse(JSON.stringify(value));
const dateToday=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const month=dateToday.slice(0,7);
const initial=()=>({settings:{start:'08:00',end:'18:00',lunch:'12:00',lunchDuration:60},clients:[],appointments:[],transactions:[],services:[{id:'hands',name:'Cuidados com as mãos',duration:60,price:80}]});
const accounts=[{profile:'podo',username:'raquel',data:initial(),revision:0},{profile:'personal',username:'jefferson',data:initial(),revision:0},{profile:'personal',username:'filla',data:initial(),revision:0}];
accounts[0].data.clients.push({id:'private-client',name:'Clinical secret must stay private',phone:'47988888888',notes:'Private clinical notes'});
const owner=accounts[1],clinic=accounts[0],friend=accounts[2];
let signedIn='jefferson';const requests=[],wire=[],assets=[],acceptedSaves=[];
const server=createServer(async(req,res)=>{
 try{
  res.setHeader('Cache-Control','no-store');
  for(const header of productionHeaders)res.setHeader(header.key,header.value);
  if(req.url==='/api'){
   let body='';for await(const chunk of req)body+=chunk;
   const input=JSON.parse(body),current=accounts.find(a=>a.username===signedIn);requests.push({username:signedIn,...clone(input)});
   res.setHeader('Content-Type','application/json');
   const send=(code,data)=>{wire.push({username:signedIn,action:input.action,code,body:clone(data)});res.statusCode=code;res.end(JSON.stringify(data))};
   if(input.action==='status')return send(200,{registered:true,setupAvailable:false});
   if(input.action==='logout'){signedIn=null;return send(200,{ok:true})}
   if(input.action==='login'){const target=accounts.find(a=>a.username===input.username);if(!target)return send(401,{error:'Credenciais inválidas'});signedIn=target.username;return send(200,accountView(target))}
   if(!current)return send(401,{error:'Sem sessão'});
   if(input.action==='me')return send(200,accountView(current));
   if(input.action==='save'){
    if(current.profile!=='podo'&&hasClinicalWrite(input))return send(403,{error:'Acesso clínico restrito'});
    if(input.revision!==current.revision)return send(409,{error:'Revisão divergente'});
    const next=current.profile==='podo'?input.data:mergeFinancialData(current.data,input.data);
    if(!next||!FinanceCore.validateFinanceChange(current.data,next))return send(400,{error:'Financeiro inválido no navegador'});
    acceptedSaves.push({username:current.username,...clone(input)});current.data=next;current.revision++;return send(200,{revision:current.revision});
   }
   if(current.username!=='jefferson')return send(403,{error:'Acesso restrito'});
   if(input.action==='adminOverview')return send(200,{accounts:accounts.filter(account=>['jefferson','raquel'].includes(account.username)).map(adminAccountView)});
   if(input.action==='adminSaveSettings'){
    const target=accounts.find(a=>a.username===(input.targetProfile==='personal'?'jefferson':'raquel'));
    if(input.revision!==target.revision)return send(409,{error:'Revisão divergente'});
    target.data={...target.data,...('finance'in input?{finance:input.finance}:{}),...('settings'in input?{settings:input.settings}:{}),...('services'in input?{services:input.services}:{})};target.revision++;return send(200,adminAccountView(target));
   }
   return send(400,{error:'Operação inesperada'});
  }
  assets.push({username:signedIn,url:req.url});
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname),file=path.resolve(root,pathname==='/'?'index.html':'.'+pathname);
  if(!file.startsWith(root+path.sep)||pathname.split('/').some(part=>part.startsWith('.'))){res.statusCode=403;return res.end()}
  res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png'})[path.extname(file)]||'text/plain');
  res.end(await readFile(file));
 }catch(error){res.statusCode=500;res.end(String(error))}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
await mkdir(path.join(root,'.browser-check'),{recursive:true});
const profilePath=path.join(root,'.browser-check','profile-'+Date.now());
let browser,socket;
try{
 browser=spawn(browserPath,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking','--remote-debugging-port=0','--user-data-dir='+profilePath,'about:blank'],{stdio:['ignore','ignore','pipe'],windowsHide:true});
 const endpoint=await new Promise((resolve,reject)=>{
  let log='';const timeout=setTimeout(()=>reject(Error('Browser startup timed out')),20000);
  browser.on('error',reject);browser.once('exit',code=>{clearTimeout(timeout);reject(Error('Browser exited '+code+': '+log.slice(-2000)))});browser.stderr.on('data',chunk=>{log+=chunk;const match=log.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(match){clearTimeout(timeout);resolve(match[1])}});
 });
 socket=new WebSocket(endpoint);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true})});
 let sequence=0;const pending=new Map(),runtimeErrors=[];
 socket.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.method==='Runtime.exceptionThrown')runtimeErrors.push(message.params.exceptionDetails.exception?.description||message.params.exceptionDetails.text);if(message.id){const task=pending.get(message.id);if(task){pending.delete(message.id);message.error?task.reject(Error(message.error.message)):task.resolve(message.result)}}});
 const call=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}))});
 const target=await call('Target.createTarget',{url:'http://127.0.0.1:'+server.address().port+'/'});
 const {sessionId}=await call('Target.attachToTarget',{targetId:target.targetId,flatten:true});
 await call('Runtime.enable',{},sessionId);
 const evaluate=async expression=>{const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},sessionId);if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value};
 const waitFor=async expression=>{const deadline=Date.now()+12000;while(Date.now()<deadline){if(await evaluate(expression))return;await new Promise(resolve=>setTimeout(resolve,50))}throw Error('Browser condition timed out: '+expression+'\n'+runtimeErrors.slice(-3).join('\n'))};
 const waitSaved=async predicate=>{const deadline=Date.now()+12000;while(Date.now()<deadline){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,50))}throw Error('Expected account change was not saved: '+predicate+'\nAlerts: '+JSON.stringify(await evaluate('window.browserAlerts'))+'\n'+runtimeErrors.slice(-3).join('\n'))};
 const click=selector=>evaluate(`(()=>{const element=document.querySelector(${JSON.stringify(selector)});if(!element)throw Error('Missing element: '+${JSON.stringify(selector)});element.click()})()`);
 const button=(text,scope='document')=>evaluate(`(()=>{const root=${scope};const element=[...root.querySelectorAll('button')].find(button=>button.textContent.trim()===${JSON.stringify(text)});if(!element)throw Error('Missing button: '+${JSON.stringify(text)});element.click()})()`);
 const input=(selector,value)=>evaluate(`(()=>{const element=document.querySelector(${JSON.stringify(selector)});if(!element)throw Error('Missing input: '+${JSON.stringify(selector)});if(element.type==='checkbox'){if(element.checked!==${JSON.stringify(value)})element.click();return}element.value=${JSON.stringify(String(value))};element.dispatchEvent(new Event('input',{bubbles:true}));element.dispatchEvent(new Event('change',{bubbles:true}))})()`);
 const submit=(selector='#modalContent form')=>click(`${selector} button[type="submit"]`);
 const nav=id=>click(`#mainNav button[data-page="${id}"]`);
 const escape=()=>evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
 const signOut=async()=>{await click('#signOutButton');await waitFor("!document.querySelector('#authVeil').classList.contains('hidden')&&document.querySelector('#appContent').children.length===0")};
 const login=async username=>{await input('#authUsername',username);await input('#authPassword','SyntheticBrowserOnly123!');await submit('#authForm');await waitFor(`document.querySelector('#authVeil').classList.contains('hidden')&&document.querySelector('#headerGreeting').textContent===${JSON.stringify('Olá, '+username.charAt(0).toUpperCase()+username.slice(1))}`)};
 const assertPrivate=async()=>{
  assert.equal(await evaluate("document.querySelectorAll('#agenda,#clientes,#ajustes,#servicesList,template').length"),0,'Personal DOM has no clinical views or templates');
  assert.deepEqual(await evaluate("['db','profile','unlocked','openAppointment','saveClient','navigate'].map(key=>typeof window[key])"),Array(6).fill('undefined'),'Application state and handlers stay module-private');
  await evaluate("window.profile='podo';for(const code of [\"openClient()\",\"navigate('agenda')\"]){const button=document.createElement('button');button.dataset.onclick=code;document.body.append(button);button.click();button.remove()}delete window.profile");
  assert.equal(await evaluate("document.querySelectorAll('#agenda,#clientes,#ajustes,#servicesList,#cName').length"),0,'Forged public profile and handler attributes do not mount clinical UI');
 };
 await waitFor("document.querySelector('#personalFinanceContent .kpi')&&document.querySelector('#authVeil').classList.contains('hidden')");
 await evaluate('window.browserAlerts=[];window.alert=message=>browserAlerts.push(message);window.confirm=()=>true;window.browserOpened=[];window.open=url=>browserOpened.push(url);window.browserCspViolations=[];document.addEventListener("securitypolicyviolation",event=>browserCspViolations.push({directive:event.violatedDirective,blocked:event.blockedURI}))');
 assert.equal(await evaluate("document.querySelector('#headerGreeting').textContent"),'Olá, Jefferson');
 await assertPrivate();
 assert.ok(!assets.some(item=>item.username==='jefferson'&&/clinic(?:-features\.js|\.html)/.test(item.url)),'Personal login does not fetch clinical views or feature module');
 assert.ok(wire.filter(item=>item.username==='jefferson'&&item.action==='me').every(item=>!('clients'in item.body.data)&&!('settings'in item.body.data)&&!('services'in item.body.data)&&!('appointments'in item.body.data)),'Personal wire data excludes clinical keys');
 await button('Conferir saldo');await input('#financeBalanceAmount','1000');await submit();await waitSaved(()=>owner.data.finance?.openingBalance?.amount===1000);
 await nav('reserva');await input('#financePlanIncome_reserve','3000');await input('#financePlanMode_reserve','percentage');await input('#financePlanValue_reserve','10');await input('#financePlanDue_reserve','15');await submit('#reserveContent form');await waitSaved(()=>owner.data.finance?.bills.some(bill=>bill.source==='reserve'&&bill.expectedAmount===300));
 await click('#reserveContent .finance-bill button');await input('#financePayMethod','pix');await submit();await waitSaved(()=>owner.data.transactions.length===1);
 assert.equal(FinanceCore.currentBalance(owner.data,dateToday),700);
 await nav('pessoal');await button('Contas e gastos');await button('Gastos','document.querySelector("#modalContent")');
 await input('.elname','Mercado');await input('.elunit','25');await input('#eDescription','Compras');await input('#ePaymentMethod','cash');await button('Salvar despesa','document.querySelector("#modalContent")');await waitSaved(()=>owner.data.transactions.length===2);
 assert.equal(FinanceCore.currentBalance(owner.data,dateToday),675);
 await button('Contas e gastos');await button('Gastos','document.querySelector("#modalContent")');await input('.elname','Compra parcelada');await input('.elunit','100.01');await input('#eDescription','Notebook parcelado');await input('#ePaymentMethod','credit');await input('#eInstallments','3');
 assert.ok(await evaluate("document.querySelector('#eCreditCard').required&&!document.querySelector('#eCreditCard').disabled"));
 await input('#eCreditCard','nubank');await button('Salvar despesa','document.querySelector("#modalContent")');await waitSaved(()=>owner.data.finance.creditPurchases.length===1);
 assert.deepEqual(owner.data.finance.creditPurchases[0].installments.map(part=>part.amount),[33.34,33.34,33.33]);
 assert.equal(owner.data.finance.bills.find(bill=>bill.sourceId==='card:nubank'&&bill.month===month).expectedAmount,33.34);
 assert.equal(FinanceCore.currentBalance(owner.data,dateToday),675,'Credit purchase preserves cash until invoice payment');
 await click('#personalFinanceContent button[aria-label*="Pagar Cartão"][aria-label*="Nubank"]');await input('#financePayMethod','pix');await submit();await waitSaved(()=>owner.data.transactions.length===3);
 assert.equal(FinanceCore.currentBalance(owner.data,dateToday),641.66);
 await nav('configuracoes');await button('Abrir dashboard');await waitFor("document.querySelectorAll('.dashboard-environment').length===2");
 const adminWire=wire.findLast(item=>item.action==='adminOverview').body;
 assert.equal(adminWire.accounts.length,2);
 assert.ok(adminWire.accounts.every(item=>!('clients'in item.data)&&!('appointments'in item.data)&&!('services'in item.data)&&!('settings'in item.data)));
 assert.ok(!JSON.stringify(adminWire).includes('Clinical secret must stay private'),'Dashboard projects counts/configuration without patient records');
 await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false},sessionId);
 const desktop=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},sessionId);await writeFile(path.join(root,'.browser-check','desktop-dashboard.png'),Buffer.from(desktop.data,'base64'));
 assert.ok(await evaluate("document.querySelector('.dashboard-grid').getBoundingClientRect().width>1000"));
 await input('#dash_podo_balance','500');await input('#dash_podo_income','4000');await input('#dash_podo_reserve','200');await evaluate("document.querySelector('#dash_podo_balance').closest('form').querySelector('button[type=submit]').click()");
 await waitSaved(()=>clinic.data.finance?.openingBalance?.amount===500);
 await waitFor("!document.querySelector('#dash_podo_balance').disabled");
 await button('Voltar às configurações');await nav('pessoal');
 await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true},sessionId);
 const mobile=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},sessionId);await writeFile(path.join(root,'.browser-check','mobile-personal.png'),Buffer.from(mobile.data,'base64'));
 assert.ok(await evaluate('document.documentElement.scrollWidth<=window.innerWidth'),'Mobile layout does not overflow');
 await signOut();
 const originalRecords=clone(accounts.slice(0,2));
 await login('filla');await assertPrivate();
 assert.equal(await evaluate("document.querySelector('#profileIcon').textContent"),'FI');
 assert.equal(await evaluate("document.querySelectorAll('#dashboard,#dashboardAccess').length"),0,'Friend receives no dashboard DOM');
 assert.equal(friend.data.transactions.length,0);assert.equal(friend.data.finance?.creditPurchases?.length||0,0);
 for(const action of ['adminOverview','adminSaveSettings'])assert.equal(await evaluate(`fetch('/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:${JSON.stringify(action)},targetProfile:'personal',revision:0})}).then(response=>response.status)`),403);
 const beforeForgery=clone(friend);
 for(const key of ['clients','appointments','services','settings']){
  const forged={action:'save',revision:friend.revision,data:{transactions:[],[key]:key==='settings'?{}:[]}};
  assert.equal(await evaluate(`fetch('/api',{method:'POST',headers:{'Content-Type':'application/json'},body:${JSON.stringify(JSON.stringify(forged))}}).then(response=>response.status)`),403);
 }
 assert.deepEqual(friend,beforeForgery,'Forged clinical writes do not change data or revision');
 await button('Conferir saldo');await input('#financeBalanceAmount','200');await submit();await waitSaved(()=>friend.data.finance?.openingBalance?.amount===200);
 assert.deepEqual(accounts.slice(0,2),originalRecords,'Tester changes preserve original accounts and revisions');
 assert.ok(acceptedSaves.filter(item=>item.username==='filla').every(item=>Object.keys(item.data).every(key=>['transactions','finance'].includes(key))),'Accepted personal saves contain financial keys only');
 await signOut();await login('raquel');
 assert.ok(assets.some(item=>item.username==='raquel'&&item.url.includes('/views/clinic.html')));
 assert.ok(assets.some(item=>item.username==='raquel'&&item.url.includes('/clinic-features.js')));
 assert.equal(await evaluate("document.querySelectorAll('#agenda,#clientes,#ajustes,#servicesList').length"),4,'Clinical account mounts its own views');
 await nav('clientes');await button('+ Cliente');
 await input('#cName','Cliente risco');await input('#cPhone','47999999999');await input('#cDiabetes','type2');await input('#cHypertension',true);await input('#cCirculationProblems',true);await input('#cAnticoagulants',true);await input('#cAllergies','Látex & iodo');await submit();
 await waitSaved(()=>clinic.data.clients.some(client=>client.name==='Cliente risco'));
 const client=clinic.data.clients.find(item=>item.name==='Cliente risco');
 assert.deepEqual(client.anamnesis,{diabetes:'type2',hypertension:true,circulationProblems:true,anticoagulants:true,allergies:'Látex & iodo'});
 await nav('agenda');await button('+ Agendar','document.querySelector("#agenda")');await input('#apClient',client.id);await click('#modalContent .service-input');await input('#apDate',dateToday);await input('#apTime','09:00');await submit();
 await waitSaved(()=>clinic.data.appointments.length===1);
 const appointment=clinic.data.appointments[0];assert.equal(appointment.price,80);
 assert.ok(await evaluate("document.querySelector('#agendaItems').textContent.includes('Diabetes tipo 2')&&document.querySelector('#agendaItems').textContent.includes('Hipertensão')"),'Agenda risk badges show saved anamnesis');
 await button('Detalhes','document.querySelector("#agendaItems")');await button('Concluir atendimento','document.querySelector("#modalContent")');await input('#completionNotes','Procedimento & avaliação concluídos.');await submit();
 await waitSaved(()=>clinic.data.appointments[0].status==='concluido');
 await waitFor("document.querySelector('#iAmount')");
 assert.equal(await evaluate("document.querySelector('#iAmount').value"),'80','Completion opens prefilled income form');
 await input('#iMethod','Dinheiro');await submit();await waitSaved(()=>clinic.data.transactions.filter(item=>item.appointmentId===appointment.id).length===1);
 await button('Detalhes','document.querySelector("#agendaItems")');
 assert.ok(!await evaluate("[...document.querySelectorAll('#modalContent button')].some(button=>button.textContent.trim()==='Registrar pagamento')"),'Paid appointment cannot request a second payment');
 await button('Abrir WhatsApp','document.querySelector("#modalContent")');
 const whatsapp=await evaluate('browserOpened.at(-1)');assert.ok(whatsapp.startsWith('https://wa.me/5547999999999?text='),'WhatsApp prefill includes encoded message');assert.ok(new URL(whatsapp).searchParams.get('text').includes('Cliente risco'));
 await escape();assert.equal(await evaluate("document.querySelector('#modalBack').classList.contains('show')"),false,'Escape closes modal');
 await nav('configuracoes');assert.equal(await evaluate("document.querySelectorAll('#dashboard,#dashboardAccess').length"),0,'Clinical account has no management dashboard');
 assert.deepEqual(await evaluate('browserAlerts'),[]);
 assert.deepEqual(await evaluate('browserCspViolations'),[],'All UI flows comply with the deployed Content Security Policy');
 assert.ok(FinanceCore.validateFinance(owner.data));assert.ok(FinanceCore.validateFinance(clinic.data));assert.ok(FinanceCore.validateFinance(friend.data));
 await signOut();assert.equal(signedIn,null);
 console.log('OK real browser: DOM-only interactions, private module state, clinical capability isolation, projected dashboard, financial invoices/reserve, independent users, anamnesis, completion/payment, WhatsApp and Escape.');
 console.log('Screenshots: .browser-check/desktop-dashboard.png and .browser-check/mobile-personal.png');
 await call('Browser.close');
}finally{
 socket?.close();if(browser&&!browser.killed)browser.kill();await new Promise(resolve=>server.close(resolve));
}
