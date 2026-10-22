import assert from 'node:assert/strict';
import { createTask, completeTask, validateTasks } from '../lib/tasks.js';
import { createTasksFeature } from '../src/client/tasks-ui.js';

const now = '2026-10-22T13:45:00.000Z';
const first = createTask(undefined, { title: '  Comprar <script>alert(1)</script>  ' }, 'raquel', now);
assert.equal(first.length, 1);
assert.equal(first[0].title, 'Comprar <script>alert(1)</script>');
assert.equal(first[0].dueDate, null);
assert.equal(first[0].createdBy, 'raquel');
assert.equal(first[0].completedAt, null);
assert.equal(validateTasks(first), true);
assert.equal(validateTasks([{ ...first[0], id: 'bad', dueDate: '2026-02-30' }]), false, 'reject impossible dates');
assert.equal(validateTasks([first[0], first[0]]), false, 'reject duplicate IDs');
assert.throws(() => createTask([], { title: 'x', dueDate: '2026-02-30' }, 'raquel', now));
assert.throws(() => createTask([], { title: ' ' }, 'raquel', now));

const completed = completeTask(first, first[0].id, 'jefferson', now);
assert.notEqual(completed, first);
assert.equal(first[0].completedAt, null, 'completion preserves prior array');
assert.equal(completed[0].completedBy, 'jefferson');
const repeated = completeTask(completed, first[0].id, 'raquel', '2026-10-23T15:00:00.000Z');
assert.deepEqual(repeated, completed, 'completed task is idempotent and keeps its original actor and time');
assert.throws(() => completeTask(first, 'missing', 'raquel', now), /não foi encontrada/);

const elements = new Map();
const $ = id => elements.get(id) || (elements.set(id, { value: '' }), elements.get(id));
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
let taskList = completed, taskRevision = 4, modalHtml = '', calls = [];
const feature = createTasksFeature({
  $, esc, requireFinance: () => true,
  modal: (_title, html) => { modalHtml = html; },
  loadTasks: async () => ({ tasks: taskList, revision: taskRevision }),
  mutateTask: async (action, body) => {
    calls.push([action, body]);
    taskRevision++;
    return { tasks: taskList, revision: taskRevision };
  }
});
await feature.openTasks();
assert.match(modalHtml, /data-onclick="openNewTask\(\)"/);
assert.doesNotMatch(modalHtml, /<form|taskTitle|taskDueDate/, 'Task list only shows actions, without a creation form');
assert.match(modalHtml, /checked disabled/);
assert.match(modalHtml, /Concluída por jefferson/);
assert.match(modalHtml, /Comprar &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
assert.doesNotMatch(modalHtml, /<script>/);
assert.match(modalHtml, /data-onchange="completeTask\(&quot;/);
feature.openNewTask();
assert.match(modalHtml, /data-onsubmit="saveTask\(\)"/);
assert.match(modalHtml, /type="submit"[^>]*>Salvar</);

elements.set('taskTitle', { value: 'Revisar agenda' });
elements.set('taskDueDate', { value: '2026-10-23' });
await feature.saveTask();
assert.deepEqual(calls[0], ['tasksCreate', { title: 'Revisar agenda', dueDate: '2026-10-23', revision: 4 }]);
assert.doesNotMatch(modalHtml, /<form|taskTitle/, 'Successful save returns to the actions list');
await feature.completeTask(first[0].id);
assert.deepEqual(calls[1], ['tasksComplete', { id: first[0].id, revision: 5 }]);

let epoch = 7, allow = true, releaseLoad, staleModalCalls = 0;
const staleFeature = createTasksFeature({
  $, esc, getEpoch: () => epoch, requireFinance: () => allow,
  modal: () => { staleModalCalls++; },
  loadTasks: () => new Promise(resolve => { releaseLoad = resolve; }),
  mutateTask: async () => ({ tasks: [], revision: 0 })
});
const staleOpen = staleFeature.openTasks();
epoch++;
releaseLoad({ tasks: completed, revision: 6 });
await staleOpen;
assert.equal(staleModalCalls, 0, 'a load from an earlier session cannot update the current UI');

let releaseMutation, mutationCalls = 0;
const busyElements = new Map([['taskTitle', { value: 'Só uma tarefa' }], ['taskDueDate', { value: '' }]]);
const busyFeature = createTasksFeature({
  $: id => busyElements.get(id), esc, requireFinance: () => true,
  modal: (_title, html) => { modalHtml = html; },
  loadTasks: async () => ({ tasks: [], revision: 8 }),
  mutateTask: async () => { mutationCalls++; return new Promise(resolve => { releaseMutation = resolve; }); }
});
await busyFeature.openTasks();
busyFeature.openNewTask();
const firstSave = busyFeature.saveTask();
await busyFeature.saveTask();
assert.equal(mutationCalls, 1, 'concurrent submission is serialized');
releaseMutation({ tasks: [], revision: 9 });
await firstSave;

let errorHtml = '', errorCalls = [];
const failureElements = new Map([['taskTitle', { value: 'Manter este texto' }], ['taskDueDate', { value: '2026-10-24' }]]);
const failureEsc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const failedCompleteTask = createTask([], { title: 'Pendente' }, 'raquel', now)[0];
const failureFeature = createTasksFeature({
  $: id => failureElements.get(id), esc: failureEsc, requireFinance: () => true,
  alert: message => errorCalls.push(message),
  modal: (_title, html) => { errorHtml = html; },
  loadTasks: async () => ({ tasks: [failedCompleteTask], revision: 10 }),
  mutateTask: async action => { throw Error(action === 'tasksComplete' ? 'Falha ao concluir.' : 'Falha ao criar.'); }
});
await failureFeature.openTasks();
failureFeature.openNewTask();
await failureFeature.saveTask();
assert.equal(failureElements.get('taskTitle').value, 'Manter este texto', 'failed creation keeps its form values');
assert.equal(failureElements.get('taskDueDate').value, '2026-10-24');
await failureFeature.completeTask(failedCompleteTask.id);
assert.doesNotMatch(errorHtml, /checked disabled/, 'failed completion reloads the unchecked server state');
assert.ok(errorCalls.length >= 2);

console.log('Task helpers and UI checks passed.');
