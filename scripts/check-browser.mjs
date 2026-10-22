import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {accountView} from '../lib/passwords.js';
import {adminAccountView,hasClinicalWrite,mergeFinancialData} from '../lib/access-control.js';
import {createTask,completeTask} from '../lib/tasks.js';
import {prepareExpenseRemoval} from '../lib/expense-removals.js';
import '../src/shared/finance-core.js';

const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const publicRoot=path.join(root,'public');
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
let ownersTasks=[],ownersTasksRevision=0;
const isolatedTasks=new Map([['filla',{tasks:[],revision:0}]]);
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
   if(['tasksList','tasksCreate','tasksComplete'].includes(input.action)){
    const shared=(current.username==='jefferson'&&current.profile==='personal')||(current.username==='raquel'&&current.profile==='podo');
    const list=shared?{tasks:ownersTasks,revision:ownersTasksRevision}:isolatedTasks.get(current.username)||{tasks:[],revision:0};
    if(input.action==='tasksList')return send(200,clone(list));
    if(!Number.isInteger(input.revision)||input.revision!==list.revision)return send(409,{error:'Tarefas atualizadas em outro aparelho.'});
    let tasks;
    try{tasks=input.action==='tasksCreate'?createTask(list.tasks,{title:input.title,dueDate:input.dueDate},current.username,new Date().toISOString()):completeTask(list.tasks,input.id,current.username,new Date().toISOString())}
    catch(error){return send(400,{error:error.message})}
    if(JSON.stringify(tasks)===JSON.stringify(list.tasks))return send(200,clone(list));
    if(shared){ownersTasks=tasks;ownersTasksRevision++}else isolatedTasks.set(current.username,{tasks,revision:list.revision+1});
    return send(200,clone(shared?{tasks:ownersTasks,revision:ownersTasksRevision}:isolatedTasks.get(current.username)));
   }
   if(current.username!=='jefferson')return send(403,{error:'Acesso restrito'});
   if(input.action==='adminRemoveExpense'){
    const targetProfile=input.targetProfile==='personal'?'personal':input.targetProfile==='podo'?'podo':null;
    const target=targetProfile==='personal'?owner:targetProfile==='podo'?clinic:null;
    if(!target||!Number.isInteger(input.revision))return send(400,{error:'Dados inválidos.'});
    if(input.revision!==target.revision)return send(409,{error:'Dados atualizados em outro aparelho.'});
    try{
     const prepared=prepareExpenseRemoval(target.data,{kind:input.kind,id:input.id,reason:input.reason},current.username,new Date().toISOString(),FinanceCore);
     target.data=prepared.data;target.revision++;
     return send(200,adminAccountView(target));
    }catch(error){return send(400,{error:error.message})}
   }
   if(input.action==='adminOverview')return send(200,{accounts:accounts.filter(account=>['jefferson','raquel'].includes(account.username)).map(adminAccountView)});
   if(input.action==='adminSaveSettings'){
    const target=accounts.find(a=>a.username===(input.targetProfile==='personal'?'jefferson':'raquel'));
    if(input.revision!==target.revision)return send(409,{error:'Revisão divergente'});
    target.data={...target.data,...('finance'in input?{finance:input.finance}:{}),...('settings'in input?{settings:input.settings}:{}),...('services'in input?{services:input.services}:{})};target.revision++;return send(200,adminAccountView(target));
   }
   return send(400,{error:'Operação inesperada'});
  }
  assets.push({username:signedIn,url:req.url});
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname),file=path.resolve(publicRoot,pathname==='/'?'index.html':'.'+pathname);
  if(!file.startsWith(publicRoot+path.sep)||pathname.split('/').some(part=>part.startsWith('.'))){res.statusCode=403;return res.end()}
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
  assert.deepEqual(await evaluate("['db','profile','unlocked','openAppointment','saveClient','navigate','openTasks','openNewTask','saveTask','completeTask','dashboardOpenExpenses'].map(key=>typeof window[key])"),Array(11).fill('undefined'),'Application state and handlers stay module-private');
  await evaluate("window.profile='podo';for(const code of [\"openClient()\",\"navigate('agenda')\"]){const button=document.createElement('button');button.dataset.onclick=code;document.body.append(button);button.click();button.remove()}delete window.profile");
  assert.equal(await evaluate("document.querySelectorAll('#agenda,#clientes,#ajustes,#servicesList,#cName').length"),0,'Forged public profile and handler attributes do not mount clinical UI');
 };
 await waitFor("document.querySelector('#personalFinanceContent .kpi')&&document.querySelector('#authVeil').classList.contains('hidden')");
 await evaluate('window.browserAlerts=[];window.alert=message=>browserAlerts.push(message);window.confirm=()=>true;window.browserOpened=[];window.open=url=>browserOpened.push(url);window.browserCspViolations=[];document.addEventListener("securitypolicyviolation",event=>browserCspViolations.push({directive:event.violatedDirective,blocked:event.blockedURI}))');
 assert.equal(await evaluate("document.querySelector('#headerGreeting').textContent"),'Olá, Jefferson');
 assert.equal(await evaluate("document.querySelector('.app-brand span').textContent"),'Easy Finance');
 assert.equal(await evaluate("document.querySelector('#profileIcon').tagName"),'BUTTON','TODO task shortcut is a button');
 assert.equal(await evaluate("document.querySelector('#profileIcon').disabled"),false,'TODO task shortcut enables after login');
 assert.equal(await evaluate("document.querySelector('#profileIcon').getAttribute('aria-label')"),'Abrir tarefas TODO');
 assert.ok(await evaluate("['Previsão de entradas e saídas','Gastos por categoria','Meta acumulada da reserva'].every(label=>document.querySelector('#personalFinanceContent').textContent.includes(label))"),'monthly forecast, categories, and reserve indicators render');
 await assertPrivate();
 assert.ok(!assets.some(item=>item.username==='jefferson'&&/clinic(?:-features\.js|\.html)/.test(item.url)),'Personal login does not fetch clinical views or feature module');
 assert.ok(wire.filter(item=>item.username==='jefferson'&&item.action==='me').every(item=>!('clients'in item.body.data)&&!('settings'in item.body.data)&&!('services'in item.body.data)&&!('appointments'in item.body.data)),'Personal wire data excludes clinical keys');
 await click('#profileIcon');await waitFor("document.querySelector('#modalTitle').textContent==='Tarefas'");
 assert.equal(await evaluate("document.querySelectorAll('#modalContent form,#taskTitle,#taskDueDate').length"),0,'TODO initially shows only the task list');
 await click('#modalContent button[aria-label="Adicionar tarefa"]');await waitFor("document.querySelector('#modalTitle').textContent==='Nova tarefa'");
 await input('#taskTitle','Revisar agenda compartilhada');await input('#taskDueDate','2026-11-05');await submit();await waitSaved(()=>ownersTasks.length===1);
 assert.equal(ownersTasks[0].createdBy,'jefferson','task creator comes from the authenticated owner');
 assert.equal(ownersTasks[0].dueDate,'2026-11-05');
 await nav('configuracoes');await button('Cadastrar saldo');await input('#financeBalanceAmount','1000');await submit();await waitSaved(()=>owner.data.finance?.openingBalance?.amount===1000);
 await input('#financePlanIncome_settings','3000');await input('#financePlanMode_settings','percentage');await input('#financePlanValue_settings','10');await input('#financePlanDue_settings','15');await submit('#financeSettingsContent form');await waitSaved(()=>owner.data.finance?.bills.some(bill=>bill.source==='reserve'&&bill.expectedAmount===300));
 assert.ok(await evaluate("document.querySelector('#financeSettingsContent').textContent.includes('Reserva mensal')"),'monthly reserve goal appears among settings recurring items');
 await input('#financeSettingsMonth',month);await input('#cardLimit_nubank','20');await button('Salvar limites do mês');await waitSaved(()=>owner.data.finance?.cardLimits?.some(limit=>limit.month===month&&limit.cardId==='nubank'&&limit.amount===20));
 await nav('reserva');
 await click('#reserveContent .finance-bill button');await input('#financePayMethod','pix');await submit();await waitSaved(()=>owner.data.transactions.length===1);
 assert.equal(FinanceCore.currentBalance(owner.data,dateToday),700);
 await nav('pessoal');await button('− Saídas','document.querySelector("#pessoal")');await waitFor("document.querySelector('#modalContent').textContent.includes('Gastos diários')");
 assert.ok(await evaluate("document.querySelector('#modalContent').textContent.indexOf('Gastos diários')<document.querySelector('#modalContent').textContent.indexOf('Contas do mês')"),'spending is the first expenses tab');
 await input('.elname','Mercado');await input('.elunit','25');await input('#eDescription','Compras');await input('#ePaymentMethod','cash');await button('Salvar despesa','document.querySelector("#modalContent")');await waitSaved(()=>owner.data.transactions.length===2);
 assert.equal(FinanceCore.currentBalance(owner.data,dateToday),675);
 await button('− Saídas','document.querySelector("#pessoal")');await waitFor("document.querySelector('#modalContent').textContent.includes('Gastos diários')");await input('.elname','Compra parcelada');await input('.elunit','100.01');await input('#eDescription','Notebook parcelado');await input('#ePaymentMethod','credit');await input('#eInstallments','3');
 assert.ok(await evaluate("document.querySelector('#eCreditCard').required&&!document.querySelector('#eCreditCard').disabled"));
 await input('#eCreditCard','nubank');
 assert.ok(await evaluate("document.querySelector('#expensePaymentPreview').textContent.includes('limite')"),'over-limit warning appears in the installment preview');
 assert.ok(await evaluate("![...document.querySelectorAll('#modalContent button')].find(button=>button.textContent.trim()==='Salvar despesa').disabled"),'card limit warning does not block saving');
 await button('Salvar despesa','document.querySelector("#modalContent")');await waitSaved(()=>owner.data.finance.creditPurchases.length===1);
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
 const paidInvoiceBeforeRemoval=clone(owner.data.finance.bills.find(bill=>bill.sourceId==='card:nubank'&&bill.month===month));
 assert.equal(paidInvoiceBeforeRemoval.status,'paid','invoice is settled before testing a credit purchase removal');
 const purchaseToRemove=owner.data.finance.creditPurchases[0],futureMonth=purchaseToRemove.installments.at(-1).date.slice(0,7);
 const futureInvoiceBeforeRemoval=owner.data.finance.bills.find(bill=>bill.sourceId==='card:nubank'&&bill.month===futureMonth);
 assert.ok(futureInvoiceBeforeRemoval&&futureInvoiceBeforeRemoval.expectedAmount>0,'future invoice contains the installment before removal');
 await evaluate("(()=>{const env=[...document.querySelectorAll('.dashboard-environment')].find(item=>item.textContent.includes('Jefferson'));if(!env)throw Error('Missing Jefferson dashboard environment');[...env.querySelectorAll('button')].find(item=>item.textContent.trim()==='Gerenciar despesas').click()})()");
 await waitFor("document.querySelector('#modalTitle').textContent.includes('Gerenciar despesas')");
 assert.ok(await evaluate("document.querySelector('#modalContent').textContent.includes('Notebook parcelado')"),'admin expense list shows credit purchases');
 const ownerRevisionBeforeRemoval=owner.revision;
 await click('#modalContent .expense-admin-row button');await input('#adminExpenseReason','Compra registrada em duplicidade');await submit();
 await waitSaved(()=>owner.revision>ownerRevisionBeforeRemoval);
 assert.equal(owner.data.finance.creditPurchases.some(purchase=>purchase.id===purchaseToRemove.id),false,'admin removal deletes the credit purchase');
 assert.equal(owner.data.finance.expenseRemovals.at(-1).reason,'Compra registrada em duplicidade','removal records its reason');
 assert.deepEqual(owner.data.finance.bills.find(bill=>bill.id===paidInvoiceBeforeRemoval.id),paidInvoiceBeforeRemoval,'paid invoice remains unchanged after removing the purchase');
 assert.equal(owner.data.finance.bills.find(bill=>bill.sourceId==='card:nubank'&&bill.month===futureMonth)?.expectedAmount,0,'future invoices recalculate without the removed purchase');
 assert.ok(await evaluate("document.querySelector('#modalContent').textContent.includes('Compra registrada em duplicidade')"),'dashboard lists the removal audit entry');
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
 assert.equal(await evaluate("document.querySelector('#profileIcon').tagName"),'BUTTON');
 assert.equal(await evaluate("document.querySelectorAll('#dashboard,#dashboardAccess').length"),0,'Friend receives no dashboard DOM');
 assert.equal(friend.data.transactions.length,0);assert.equal(friend.data.finance?.creditPurchases?.length||0,0);
 for(const action of ['adminOverview','adminSaveSettings','adminRemoveExpense'])assert.equal(await evaluate(`fetch('/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:${JSON.stringify(action)},targetProfile:'personal',revision:0,kind:'transaction',id:'none',reason:'test'})}).then(response=>response.status)`),403);
 const beforeForgery=clone(friend);
 for(const key of ['clients','appointments','services','settings']){
  const forged={action:'save',revision:friend.revision,data:{transactions:[],[key]:key==='settings'?{}:[]}};
  assert.equal(await evaluate(`fetch('/api',{method:'POST',headers:{'Content-Type':'application/json'},body:${JSON.stringify(JSON.stringify(forged))}}).then(response=>response.status)`),403);
 }
 assert.deepEqual(friend,beforeForgery,'Forged clinical writes do not change data or revision');
 await click('#profileIcon');await waitFor("document.querySelector('#modalTitle').textContent==='Tarefas'");
 assert.ok(await evaluate("!document.querySelector('#modalContent').textContent.includes('Revisar agenda compartilhada')"),'Filla task list is isolated from the owners');
 await click('#modalContent button[aria-label="Adicionar tarefa"]');await waitFor("document.querySelector('#modalTitle').textContent==='Nova tarefa'");
 await button('Cancelar','document.querySelector("#modalContent")');await waitFor("document.querySelector('#modalTitle').textContent==='Tarefas'");
 assert.equal(await evaluate("document.querySelectorAll('#modalContent form').length"),0,'Cancel returns to task list');
 await click('#modalContent button[aria-label="Adicionar tarefa"]');
 await input('#taskTitle','Tarefa privada da Filla');await submit();await waitSaved(()=>isolatedTasks.get('filla')?.tasks.length===1);
 assert.equal(ownersTasks.length,1,'Filla task does not enter the shared owners list');await escape();
 await nav('configuracoes');await button('Cadastrar saldo');await input('#financeBalanceAmount','200');await submit();await waitSaved(()=>friend.data.finance?.openingBalance?.amount===200);
 assert.deepEqual(accounts.slice(0,2),originalRecords,'Tester changes preserve original accounts and revisions');
 assert.ok(acceptedSaves.filter(item=>item.username==='filla').every(item=>Object.keys(item.data).every(key=>['transactions','finance'].includes(key))),'Accepted personal saves contain financial keys only');
 await signOut();await login('raquel');
 assert.equal(await evaluate("document.querySelector('#profileIcon').tagName"),'BUTTON');
 await click('#profileIcon');await waitFor("document.querySelector('#modalTitle').textContent==='Tarefas'");
 assert.ok(await evaluate("document.querySelector('#modalContent').textContent.includes('Revisar agenda compartilhada')&&document.querySelector('#modalContent').textContent.includes('05/11/2026')"),'Raquel sees the shared task name and due date');
 assert.ok(await evaluate("document.querySelector('#modalContent').textContent.includes('Criada por jefferson')"),'shared task keeps its creator name');
 const sharedTaskId=ownersTasks[0].id;
 await click('#modalContent input[type="checkbox"][aria-label="Concluir Revisar agenda compartilhada"]');
 await waitSaved(()=>ownersTasks[0].completedBy==='raquel');
 const taskCompletionRevision=ownersTasksRevision;
 assert.equal(ownersTasks[0].completedBy,'raquel','Raquel is recorded as the completer');
 assert.ok(await evaluate("(()=>{const box=document.querySelector('#modalContent input[type=checkbox]');return box.checked&&box.disabled})()"),'completed tasks cannot be unchecked');
 await click('#modalContent input[type="checkbox"][aria-label="Concluir Revisar agenda compartilhada"]');
 assert.equal(ownersTasksRevision,taskCompletionRevision,'disabled completed task cannot be toggled again');
 await escape();
 assert.equal(await evaluate("fetch('/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'adminRemoveExpense',targetProfile:'podo',revision:0,kind:'credit',id:'none',reason:'test'})}).then(response=>response.status)"),403,'Raquel cannot call admin expense removal');
 assert.ok(assets.some(item=>item.username==='raquel'&&item.url.includes('/views/clinic.html')));
 assert.ok(assets.some(item=>item.username==='raquel'&&item.url.includes('/assets/clinic-features.js')));
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
