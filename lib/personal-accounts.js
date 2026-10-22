import {randomBytes} from 'node:crypto';
import {hashPassword} from './passwords.js';
import '../src/shared/finance-core.js';

const invalid=message=>{throw Object.assign(new Error(message),{code:'PERSONAL_ACCOUNT_INVALID'})};
export function preparePersonalAccount(input){
 const username=typeof input?.username==='string'?input.username.trim().toLowerCase():'';
 if(!/^[a-z0-9][a-z0-9_.-]{2,39}$/.test(username)||['jefferson','raquel'].includes(username))invalid('Escolha um novo usuário de 3 a 40 caracteres. As contas principais não podem ser substituídas.');
 if(typeof input.password!=='string'||input.password.length<10||input.password.length>128)invalid('A senha precisa ter 10 a 128 caracteres.');
 const salt=randomBytes(16).toString('hex');
 const data={services:[],clients:[],appointments:[],transactions:[],settings:{start:'08:00',end:'18:00',lunch:'12:00',lunchDuration:60}};
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit'}).formatToParts(new Date());
 const month=['year','month'].map(type=>parts.find(part=>part.type===type).value).join('-');
 globalThis.FinanceCore.ensureCreditCards(data,month);
 return {username,profile:'personal',salt,hash:hashPassword(input.password,salt),data};
}
