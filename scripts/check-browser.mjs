import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import '../finance-core.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const browserPath=[process.env.BROWSER_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(file=>file&&existsSync(file));
if(!browserPath){console.log('Browser check skipped: set BROWSER_PATH to Chromium/Edge.');process.exit(0)}
const clone=value=>JSON.parse(JSON.stringify(value));
const initial=()=>({settings:{start:'08:00',end:'18:00',lunch:'12:00',lunchDuration:60},clients:[],appointments:[],transactions:[],services:[{id:'hands',name:'Cuidados com as mãos',duration:60,price:80}]});
const accounts=[{profile:'podo',username:'raquel',data:initial(),revision:0},{profile:'personal',username:'jefferson',data:initial(),revision:0}];
let signedIn='personal';const requests=[];
const server=createServer(async(req,res)=>{
 try{
  res.setHeader('Cache-Control','no-store');
  if(req.url==='/api'){
   let body='';for await(const chunk of req)body+=chunk;
   const input=JSON.parse(body),current=accounts.find(a=>a.profile===signedIn);requests.push(input.action);
   res.setHeader('Content-Type','application/json');
   const send=(code,data)=>{res.statusCode=code;res.end(JSON.stringify(data))};
   if(input.action==='status')return send(200,{registered:['podo','personal'],accounts:accounts.map(({profile,username})=>({profile,username})),setupAvailable:false});
   if(input.action==='logout'){signedIn=null;return send(200,{ok:true})}
   if(input.action==='login'){signedIn=input.username==='raquel'?'podo':'personal';return send(200,{...accounts.find(a=>a.profile===signedIn),mustChangePassword:false})}
   if(!current)return send(401,{error:'Sem sessão'});
   if(input.action==='me')return send(200,{...current,mustChangePassword:false});
   if(input.action==='save'){
    if(input.revision!==current.revision)return send(409,{error:'Revisão divergente'});
    if(!FinanceCore.validateFinanceChange(current.data,input.data))return send(400,{error:'Financeiro inválido no navegador'});
    current.data=input.data;current.revision++;return send(200,{revision:current.revision});
   }
   if(current.username!=='jefferson')return send(403,{error:'Acesso restrito'});
   if(input.action==='adminOverview')return send(200,{accounts});
   if(input.action==='adminSaveSettings'){
    const target=accounts.find(a=>a.profile===input.targetProfile);
    if(input.revision!==target.revision)return send(409,{error:'Revisão divergente'});
    target.data={...target.data,...('finance'in input?{finance:input.finance}:{}),...('settings'in input?{settings:input.settings}:{}),...('services'in input?{services:input.services}:{})};target.revision++;return send(200,{data:target.data,revision:target.revision});
   }
   return send(400,{error:'Operação inesperada'});
  }
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname),file=path.resolve(root,pathname==='/'?'index.html':'.'+pathname);
  if(!file.startsWith(root)){res.statusCode=403;return res.end()}
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
 let sequence=0;const pending=new Map();
 socket.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.id){const task=pending.get(message.id);if(task){pending.delete(message.id);message.error?task.reject(Error(message.error.message)):task.resolve(message.result)}}});
 const call=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}))});
 const target=await call('Target.createTarget',{url:'http://127.0.0.1:'+server.address().port+'/'});
 const {sessionId}=await call('Target.attachToTarget',{targetId:target.targetId,flatten:true});
 const evaluate=async expression=>{const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},sessionId);if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value};
 const waitFor=async expression=>{const deadline=Date.now()+10000;while(Date.now()<deadline){if(await evaluate(expression))return;await new Promise(resolve=>setTimeout(resolve,50))}throw Error('Browser condition timed out: '+expression)};
 await waitFor("typeof unlocked!=='undefined'&&unlocked&&document.querySelector('#personalFinanceContent .kpi')");
 await evaluate('window.browserAlerts=[];window.alert=message=>browserAlerts.push(message);window.confirm=()=>true');
 assert.equal(await evaluate("$('headerGreeting').textContent"),'Olá, Jefferson');
 assert.equal(await evaluate("document.querySelectorAll('#podoPick,#personalPick,#authPodoPick,#authPersonalPick').length"),0);
 await evaluate("navigate('configuracoes');financeOpenBalance();$('financeBalanceAmount').value='1000';document.querySelector('#modalContent form').requestSubmit();saveChain");
 assert.equal(await evaluate('FinanceCore.currentBalance(db,dateToday)'),1000);
 await evaluate("navigate('reserva');$('financePlanIncome_reserve').value='3000';$('financePlanMode_reserve').value='percentage';financeUpdatePlanMode('reserve');$('financePlanValue_reserve').value='10';$('financePlanDue_reserve').value='15';document.querySelector('#reserveContent form').requestSubmit();saveChain");
 assert.equal(await evaluate("db.finance.bills.find(b=>b.source==='reserve').expectedAmount"),300);
 await evaluate("financeOpenPayment(db.finance.bills.find(b=>b.source==='reserve').id);$('financePayAmount').value='300';$('financePayMethod').value='pix';document.querySelector('#modalContent form').requestSubmit();saveChain");
 assert.equal(await evaluate('FinanceCore.currentBalance(db,dateToday)'),700);
 await evaluate("openFinanceExpenses('spending');document.querySelector('.elname').value='Mercado';document.querySelector('.elunit').value='25';$('eDescription').value='Compras';$('ePaymentMethod').value='cash';saveExpense();saveChain");
 assert.equal(await evaluate('FinanceCore.currentBalance(db,dateToday)'),675);
 assert.equal(await evaluate("document.querySelectorAll('input[capture],input[accept=\"image/*\"]').length"),0);
 await evaluate("financeOpenRecurring();$('financeRecurringDescription').value='Energia';$('financeRecurringType').value='variable';financeUpdateRecurringType();$('financeRecurringAmount').value='';document.querySelector('#modalContent form').requestSubmit();saveChain");
 assert.equal(await evaluate("db.finance.recurringBills[0].expectedAmount"),null);
 await evaluate('closeModal();navigate("configuracoes");openManagementDashboard()');
 await waitFor("document.querySelectorAll('.dashboard-environment').length===2");
 await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false},sessionId);
 const desktop=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},sessionId);await writeFile(path.join(root,'.browser-check','desktop-dashboard.png'),Buffer.from(desktop.data,'base64'));
 assert.ok(await evaluate("document.querySelector('.dashboard-grid').getBoundingClientRect().width>1000"));
 await evaluate("$('dash_podo_balance').value='500';$('dash_podo_income').value='4000';$('dash_podo_reserve').value='200';saveDashboardSettings('podo')");
 assert.equal(accounts[0].data.finance.openingBalance.amount,500);
 assert.equal(await evaluate('profile'),'personal');assert.equal(await evaluate('FinanceCore.currentBalance(db,dateToday)'),675);
 await evaluate("navigate('pessoal')");
 await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true},sessionId);
 const mobile=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},sessionId);await writeFile(path.join(root,'.browser-check','mobile-personal.png'),Buffer.from(mobile.data,'base64'));
 assert.ok(await evaluate('document.documentElement.scrollWidth<=window.innerWidth'),'Mobile layout must not overflow horizontally');
 assert.deepEqual(await evaluate('browserAlerts'),[]);
 await evaluate("$('signOutButton').click()");
 await waitFor("!unlocked&&!$('authVeil').classList.contains('hidden')");
 assert.ok(requests.includes('logout'));
 assert.equal(await evaluate('currentUsername'),'');
 assert.equal(await evaluate("$('dashboardContent').innerHTML"),'');
 await evaluate("$('authUsername').value='raquel';syncLoginProfile();$('authPassword').value='BrowserTestOnly!';document.querySelector('#authForm').requestSubmit()");
 await waitFor("unlocked&&profile==='podo'");
 assert.equal(await evaluate("$('headerGreeting').textContent"),'Olá, Raquel');
 assert.ok(await evaluate("$('dashboardAccess').classList.contains('hidden')"));
 assert.ok(await evaluate('FinanceCore.validateFinance(db)'));
 await evaluate("$('signOutButton').click()");
 await waitFor("!unlocked&&!$('authVeil').classList.contains('hidden')");
 assert.equal(signedIn,null,'Both profiles can end their server session from the header');
 console.log('OK real browser: greetings, username login, balance, monthly reserve/payment, spending, variable recurring, desktop dashboard, isolated settings and mobile layout.');
 console.log('Screenshots: .browser-check/desktop-dashboard.png and .browser-check/mobile-personal.png');
 await call('Browser.close');
}finally{
 socket?.close();if(browser&&!browser.killed)browser.kill();await new Promise(resolve=>server.close(resolve));
}
