import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { hashPassword } from '../lib/passwords.js';

const localFile = new URL('../.account-setup.local.json', import.meta.url);
const base = process.env.APP_URL || 'https://podoagenda.vercel.app';
const origin = new URL(base).origin;
const command = process.argv[2];

async function request(action, extra = {}, cookie) {
  const response = await fetch(origin + '/api', {
    method:'POST', headers:{'Content-Type':'application/json',Origin:origin,...(cookie?{Cookie:cookie}:{})},
    body:JSON.stringify({action,...extra}), signal:AbortSignal.timeout(25000),
  });
  return {response,body:await response.json()};
}

if (command === 'prepare') {
  try { await readFile(localFile); throw new Error('A preparação local já existe. Não será sobrescrita.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const {publicKey,privateKey} = generateKeyPairSync('ed25519');
  const accounts = [{username:'raquel',profile:'podo'},{username:'jefferson',profile:'personal'}].map(account => {
    const password=randomBytes(15).toString('base64url'),salt=randomBytes(16).toString('hex');
    return {...account,password,salt,hash:hashPassword(password,salt)};
  });
  await writeFile(localFile,JSON.stringify({privateKey:privateKey.export({type:'pkcs8',format:'pem'}),accounts},null,2),{flag:'wx',mode:0o600});
  await writeFile(new URL('../lib/provisioning-key.js',import.meta.url),`export const provisioningPublicKey = ${JSON.stringify(publicKey.export({type:'spki',format:'pem'}))};\n`);
  console.log('Autorização pública preparada. Senhas e chave privada ficaram somente no arquivo local ignorado pelo Git.');
} else {
  const local=JSON.parse(await readFile(localFile,'utf8'));
  if(command === 'provision') {
    const payload=JSON.stringify({expiresAt:Date.now()+900000,accounts:local.accounts.map(({password,...account})=>account)});
    const signature=sign(null,Buffer.from(payload),local.privateKey).toString('base64');
    const {response,body}=await request('provision',{payload,signature});
    if(response.status!==201)throw Error(`Criação não concluída (HTTP ${response.status}): ${body.error}`);
    console.log(JSON.stringify(body));
  } else if(command === 'check') {
    for(const account of local.accounts) {
      const {response,body}=await request('login',{profile:account.profile,username:account.username,password:account.password});
      assert.equal(response.status,200,`Login de ${account.username}`);
      assert.equal(body.username,account.username);
      assert.equal(body.profile,account.profile);
      assert.equal(body.mustChangePassword,true);
      assert.equal('data' in body,false);
      const cookie=response.headers.get('set-cookie')?.split(';')[0];
      assert.ok(cookie);
      try {
        const me=await request('me',{},cookie);
        assert.equal(me.response.status,200);
        assert.equal(me.body.mustChangePassword,true);
        assert.equal('data' in me.body,false);
        const save=await request('save',{data:{},revision:0},cookie);
        assert.equal(save.response.status,403);
        assert.equal(save.body.code,'PASSWORD_CHANGE_REQUIRED');
      } finally { await request('logout',{},cookie); }
      console.log(`${account.username}: login OK, área correta e troca obrigatória confirmada.`);
    }
  } else if(command === 'credentials') {
    for(const {username,profile,password} of local.accounts)console.log(JSON.stringify({username,profile,password}));
  } else throw Error('Use prepare, provision, check ou credentials.');
}
