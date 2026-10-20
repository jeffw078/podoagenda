import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]).join('\n');
new vm.Script(script);
assert.ok(script.lastIndexOf('initAuth();') > script.indexOf('let registered='), 'Authentication state must initialize before startup');
const auth = script.slice(script.indexOf('let registered='), script.lastIndexOf('renderAll();initAuth();'));

function fixture() {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) {
      const classes = new Set();
      elements.set(id, {value:'',type:'password',textContent:'',disabled:false,attributes:{},classList:{add:c=>classes.add(c),remove:c=>classes.delete(c),contains:c=>classes.has(c),toggle(c,on){if(on)classes.add(c);else classes.delete(c)}},setAttribute(name,value){this.attributes[name]=value},focus(){}});
    }
    return elements.get(id);
  };
  const calls = [];
  let response = {registered:[],setupAvailable:true};
  let fail = false;
  const context = vm.createContext({$:element,profile:'podo',unlocked:false,closeModal(){},document:{body:element('body')},console,saveChain:Promise.resolve(),initial:()=>({}),db:{},revision:0,saveFailed:false,api:async(action,payload)=>{calls.push({action,payload});if(fail)throw Error('Erro interno no servidor');if(action==='status')return response;if(action==='me')throw Error('Sem sessão');if(action==='logout')return {ok:true};return {profile:payload.profile}},Promise});
  vm.runInContext(auth, context);
  vm.runInContext('startSession=result=>{globalThis.session=result}', context);
  return {element,calls,run:code=>vm.runInContext(code,context),setResponse:value=>{response=value},setFail:value=>{fail=value}};
}

const first = fixture();
await first.run('initAuth()');
assert.equal(first.element('authAction').textContent, 'Criar senha e acessar');
assert.equal(first.element('authPassword').autocomplete, 'new-password');
assert.equal(first.element('confirmBox').classList.contains('hidden'), false);
first.element('authPassword').value = 'SenhaTeste123';
first.element('authPasswordConfirm').value = 'OutraSenha123';
first.element('setupCode').value = 'activation-test';
await first.run('authSubmit()');
assert.equal(first.calls.some(c=>c.action==='register'), false);
assert.match(first.element('authFeedback').textContent, /não coincidem/);
first.element('authPasswordConfirm').value = 'SenhaTeste123';
first.element('setupCode').value = '';
await first.run('authSubmit()');
assert.equal(first.calls.some(c=>c.action==='register'), false);
first.element('setupCode').value = 'activation-test';
await first.run('authSubmit()');
assert.equal(first.calls.at(-1).action, 'register');
assert.equal(first.calls.at(-1).payload.profile, 'podo');
assert.equal(first.calls.at(-1).payload.setupCode, 'activation-test');
first.run('chooseProfile("personal")');
assert.equal(first.element('setupCode').value, '');
assert.equal(first.element('authPersonalPick').attributes['aria-pressed'], 'true');
first.run('toggleAuthPassword()');
assert.equal(first.element('authPassword').type, 'text');
first.run('chooseProfile("podo")');
assert.equal(first.element('authPassword').type, 'password');

const existing = fixture();
existing.setResponse({registered:['podo'],setupAvailable:false});
await existing.run('initAuth()');
assert.equal(existing.element('authAction').textContent, 'Entrar');
assert.equal(existing.element('setupBox').classList.contains('hidden'), true);
existing.element('authPassword').value = 'SenhaTeste123';
await existing.run('authSubmit()');
assert.equal(existing.calls.at(-1).action, 'login');
assert.equal('setupCode' in existing.calls.at(-1).payload, false);
existing.run('chooseProfile("personal")');
assert.equal(existing.element('authAction').disabled, true);
assert.equal(existing.element('authAction').textContent, 'Aguardando ativação');

const outage = fixture();
outage.setFail(true);
await outage.run('initAuth()');
assert.equal(outage.element('authAction').disabled, true);
assert.equal(outage.element('setupBox').classList.contains('hidden'), true);
assert.equal(outage.element('authRetry').classList.contains('hidden'), false);
assert.equal(outage.element('authFeedback').textContent, 'Erro interno no servidor');
assert.equal(outage.element('authAction').textContent, 'Acesso indisponível');
await outage.run('authSubmit()');
assert.equal(outage.calls.some(c=>c.action==='register'), false);
outage.setFail(false);
await outage.run('initAuth()');
assert.equal(outage.element('authAction').disabled, false);
assert.equal(outage.element('authFeedback').textContent, '');

const temporary=fixture();
temporary.setResponse({registered:['podo','personal'],setupAvailable:false,accounts:[{profile:'podo',username:'raquel'},{profile:'personal',username:'jefferson'}]});
await temporary.run('initAuth()');
assert.equal(temporary.element('authUsername').value,'raquel');
assert.equal(temporary.element('authPassword').disabled,false);
temporary.run('showPasswordChange({profile:"podo",username:"raquel",mustChangePassword:true})');
assert.equal(temporary.element('authAction').textContent,'Salvar nova senha e entrar');
assert.equal(temporary.element('setupCode').disabled,true);
assert.equal(temporary.element('authPasswordConfirm').required,true);
assert.equal(temporary.element('authPersonalPick').disabled,true);
temporary.element('authPassword').value='SenhaNova123!';
temporary.element('authPasswordConfirm').value='Diferente123!';
await temporary.run('authSubmit()');
assert.equal(temporary.calls.some(c=>c.action==='changePassword'),false);
temporary.element('authPasswordConfirm').value='SenhaNova123!';
await temporary.run('authSubmit()');
assert.equal(temporary.calls.at(-1).action,'changePassword');
assert.equal(temporary.calls.at(-1).payload.password,'SenhaNova123!');
assert.equal('setupCode' in temporary.calls.at(-1).payload,false);
await temporary.run('lockApp()');
temporary.run('chooseProfile("personal")');
assert.equal(temporary.element('authUsername').value,'jefferson');
assert.equal(temporary.element('authPassword').disabled,false);
console.log('OK: autenticação, recuperação da API, usuários nomeados e troca obrigatória da senha temporária.');
