import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { verifyProvisioning } from '../lib/account-provisioning.js';
import { hashPassword, passMatches, accountView } from '../lib/passwords.js';

const {publicKey,privateKey}=generateKeyPairSync('ed25519');
const now=Date.now();
const accounts=[{profile:'podo',username:'raquel'},{profile:'personal',username:'jefferson'}].map(a=>({...a,salt:'a'.repeat(32),hash:'b'.repeat(128)}));
const authorize=value=>{
  const payload=JSON.stringify(value);
  return {payload,signature:sign(null,Buffer.from(payload),privateKey).toString('base64')};
};
const body=authorize({expiresAt:now+60000,accounts});
assert.deepEqual(verifyProvisioning(body,now,publicKey),accounts);
assert.equal(verifyProvisioning({...body,payload:body.payload.replace('raquel','other')},now,publicKey),null);
assert.equal(verifyProvisioning(body,now+120000,publicKey),null);
assert.equal(verifyProvisioning(authorize({expiresAt:now+60000,accounts:[accounts[0],accounts[0]]}),now,publicKey),null);
assert.equal(verifyProvisioning(authorize({expiresAt:now+60000,accounts:[{...accounts[0],username:'jefferson'},accounts[1]]}),now,publicKey),null);
const other=generateKeyPairSync('ed25519');
assert.equal(verifyProvisioning(body,now,other.publicKey),null);
assert.equal(verifyProvisioning({payload:'malformed',signature:'no'},now,publicKey),null);

const password='Example-Temporary-Only',salt='a'.repeat(32),hash=hashPassword(password,salt);
assert.equal(passMatches(password,salt,hash),true);
assert.equal(passMatches('another-password',salt,hash),false);
const pending=accountView({profile:'podo',username:'raquel',password_change_required:true,data:{secret:'private'},revision:0,password_hash:hash,password_salt:salt});
assert.equal(pending.mustChangePassword,true);
assert.equal('data' in pending,false);
assert.equal('password_hash' in pending,false);
assert.equal('password_salt' in pending,false);
const ready=accountView({profile:'personal',username:'jefferson',password_change_required:false,data:{},revision:0});
assert.equal(ready.mustChangePassword,false);
assert.deepEqual(ready.data,{});
console.log('OK: criação assinada, expiração, proteção contra adulteração e restrições da senha temporária.');
