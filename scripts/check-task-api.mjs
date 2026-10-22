import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { randomBytes, createHash, generateKeyPairSync, sign, webcrypto } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { schemaAwareSql } from '../lib/database-schema.js';
import { readDatabaseUrl, databaseFailure } from '../lib/database-errors.js';
import { hashPassword, passMatches, accountView } from '../lib/passwords.js';
import { verifyProvisioning } from '../lib/account-provisioning.js';
import { hasClinicalWrite, mergeFinancialData, adminAccountView, validAnamnesis } from '../lib/access-control.js';
import { validateCardLimits } from '../src/shared/finance-insights.js';
import { createTask, completeTask, validateTasks } from '../lib/tasks.js';
import { prepareExpenseRemoval, expenseHistoryUnchanged } from '../lib/expense-removals.js';
import '../src/shared/finance-core.js';

const db = new PGlite();
try {
  const schema = await readFile(new URL('../schema.sql', import.meta.url), 'utf8');
  await db.exec(schema);
  const sql = async (strings, ...values) => {
    const statement = strings.reduce((text, part, index) => text + (index ? '$' + index : '') + part, '');
    return (await db.query(statement, values)).rows;
  };
  sql.query = statement => ({ statement });
  sql.transaction = async statements => {
    await db.exec('BEGIN');
    try { for (const { statement } of statements) await db.exec(statement); await db.exec('COMMIT'); }
    catch (error) { await db.exec('ROLLBACK'); throw error; }
  };
  const { publicKey } = generateKeyPairSync('ed25519');
  const deps = {
    neon: () => sql, randomBytes, createHash, readDatabaseUrl, databaseFailure, schemaAwareSql,
    hashPassword, passMatches, accountView, hasClinicalWrite, mergeFinancialData, adminAccountView,
    validAnamnesis, verifyProvisioning: body => verifyProvisioning(body, Date.now(), publicKey),
    validateCardLimits, createTask, completeTask, validateTasks, prepareExpenseRemoval, expenseHistoryUnchanged
  };
  const source = (await readFile(new URL('../api/index.js', import.meta.url), 'utf8'))
    .replace(/^import .*;\r?\n/gm, '')
    .replace('export default async function handler', 'async function handler');
  const factory = vm.runInNewContext('(function(deps){const {' + Object.keys(deps).join(',') + '}=deps;\n' + source + '\nreturn handler;})', {
    FinanceCore: globalThis.FinanceCore, crypto: webcrypto, Buffer, URL,
    process: { env: { DATABASE_URL: 'postgresql://test:test@db.example/test', SETUP_CODE: 'Example-Setup-Only!' } }, console
  });
  const handler = factory(deps);
  const request = async (body, cookie) => {
    const headers = {}; let result;
    const res = { setHeader(name, value) { headers[name] = value; }, end(value) { result = JSON.parse(value); } };
    await handler({ method: 'POST', headers: { host: 'podoagenda.example', origin: 'https://podoagenda.example', ...(cookie ? { cookie } : {}) }, body }, res);
    return { status: res.statusCode, body: result, cookie: headers['Set-Cookie']?.split(';')[0] };
  };

  const accounts = [
    { profile: 'personal', username: 'jefferson' },
    { profile: 'podo', username: 'raquel' },
    { profile: 'personal', username: 'filla' }
  ];
  for (const account of accounts) {
    const salt = randomBytes(16).toString('hex'), password = `${account.username}-Temporary-Example!`;
    await db.query('INSERT INTO studio_accounts(profile,username,password_salt,password_hash,password_change_required,data) VALUES($1,$2,$3,$4,FALSE,$5::jsonb)', [
      account.profile, account.username, salt, hashPassword(password, salt), JSON.stringify({
        services: [], clients: [], appointments: [], transactions: [], settings: { start: '08:00', end: '18:00', lunch: '12:00', lunchDuration: 60 }
      })
    ]);
    const login = await request({ action: 'login', profile: account.profile, username: account.username, password });
    assert.equal(login.status, 200, `${account.username} login`);
    account.cookie = login.cookie;
  }
  const jeff = accounts[0], raquel = accounts[1], filla = accounts[2];
  const startJeff = await request({ action: 'tasksList' }, jeff.cookie);
  const startRaquel = await request({ action: 'tasksList' }, raquel.cookie);
  const startFilla = await request({ action: 'tasksList' }, filla.cookie);
  assert.deepEqual(startJeff.body, { tasks: [], revision: 0 });
  assert.deepEqual(startRaquel.body, startJeff.body, 'Jefferson and Raquel share the owners task list');
  assert.deepEqual(startFilla.body, { tasks: [], revision: 0 }, 'Filla starts with a separate task list');

  const created = await request({
    action: 'tasksCreate', revision: startRaquel.body.revision,
    title: 'Revisar <script>agenda</script>', dueDate: '2026-10-30', createdBy: 'filla', completedBy: 'filla'
  }, raquel.cookie);
  assert.equal(created.status, 200);
  assert.equal(created.body.revision, 1);
  assert.equal(created.body.tasks.length, 1);
  const task = created.body.tasks[0];
  assert.equal(task.createdBy, 'raquel', 'server derives task creator from the authenticated account');
  assert.equal(task.completedBy, null, 'client cannot forge completion metadata');
  assert.equal(task.completedAt, null);
  assert.equal(task.title, 'Revisar <script>agenda</script>');
  assert.equal(task.dueDate, '2026-10-30');
  assert.equal(validateTasks(created.body.tasks), true);
  assert.deepEqual((await request({ action: 'tasksList' }, jeff.cookie)).body, created.body, 'Jefferson sees Raquel’s new shared task');

  assert.equal((await request({ action: 'tasksCreate', revision: 0, title: 'Stale task' }, jeff.cookie)).status, 409, 'stale shared revision is rejected');
  assert.equal((await request({ action: 'tasksCreate', revision: 1, title: 'Bad date', dueDate: '2026-02-30' }, jeff.cookie)).status, 400);
  assert.equal((await request({ action: 'tasksCreate', revision: 1, title: '   ' }, jeff.cookie)).status, 400);
  assert.deepEqual((await request({ action: 'tasksList' }, raquel.cookie)).body, created.body, 'invalid requests leave the list untouched');

  const completed = await request({ action: 'tasksComplete', id: task.id, revision: 1, completedBy: 'filla', completedAt: '2000-01-01T00:00:00.000Z' }, jeff.cookie);
  assert.equal(completed.status, 200);
  assert.equal(completed.body.revision, 2);
  assert.equal(completed.body.tasks[0].completedBy, 'jefferson');
  const originalCompletion = completed.body.tasks[0].completedAt;
  assert.ok(Number.isFinite(Date.parse(originalCompletion)));
  assert.equal((await request({ action: 'tasksComplete', id: task.id, revision: 1 }, raquel.cookie)).status, 409, 'stale completion is rejected');
  const repeated = await request({ action: 'tasksComplete', id: task.id, revision: 2 }, raquel.cookie);
  assert.equal(repeated.status, 200);
  assert.equal(repeated.body.revision, 2, 'repeat completion does not bump revision');
  assert.equal(repeated.body.tasks[0].completedBy, 'jefferson', 'completion actor is immutable');
  assert.equal(repeated.body.tasks[0].completedAt, originalCompletion, 'completion timestamp is immutable');
  assert.equal((await request({ action: 'tasksComplete', id: 'missing', revision: 2 }, jeff.cookie)).status, 400);

  const fillaCreate = await request({ action: 'tasksCreate', revision: 0, title: task.title, dueDate: null }, filla.cookie);
  assert.equal(fillaCreate.status, 200);
  assert.equal(fillaCreate.body.revision, 1);
  assert.notEqual(fillaCreate.body.tasks[0].id, task.id);
  assert.deepEqual((await request({ action: 'tasksList' }, jeff.cookie)).body, repeated.body, 'Filla’s task does not enter the shared owner list');
  assert.deepEqual((await request({ action: 'tasksList' }, filla.cookie)).body, fillaCreate.body);

  const fillaAccount = await request({ action: 'me' }, filla.cookie);
  assert.equal('tasks' in fillaAccount.body.data, false, 'task list is kept outside the financial account document');
  const validFinanceSave = await request({ action: 'save', revision: fillaAccount.body.revision, data: { transactions: [] } }, filla.cookie);
  assert.equal(validFinanceSave.status, 200);
  assert.deepEqual((await request({ action: 'tasksList' }, filla.cookie)).body, fillaCreate.body, 'a financial save preserves the separate task list');
  const forgedTaskSave = await request({ action: 'save', revision: validFinanceSave.body.revision, data: { transactions: [], tasks: fillaCreate.body.tasks } }, filla.cookie);
  assert.equal(forgedTaskSave.status, 400, 'financial saves cannot write the task list');
  assert.deepEqual((await request({ action: 'tasksList' }, filla.cookie)).body, fillaCreate.body);

  const scopes = (await db.query('SELECT scope,revision FROM studio_task_lists ORDER BY scope')).rows;
  assert.deepEqual(scopes.map(row => row.scope).sort(), ['account:' + (await db.query("SELECT id FROM studio_accounts WHERE username='filla'")).rows[0].id, 'owners'].sort());
  assert.deepEqual(scopes.map(row => row.revision).sort(), [1, 2]);
  console.log('Task API checks passed: shared owner scope, account isolation, auth-derived actors, immutable completion, revisions, and finance separation.');
} finally {
  await db.close();
}
