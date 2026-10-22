import { randomUUID } from 'node:crypto';

const invalid = message => { throw Object.assign(new Error(message), { code: 'TASK_INVALID' }); };

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validTimestamp(value) {
  if (typeof value !== 'string') return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

function validUsername(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 80;
}

function validTask(task) {
  return !!task && typeof task === 'object' && !Array.isArray(task)
    && typeof task.id === 'string' && task.id.trim().length > 0 && task.id.length <= 120
    && typeof task.title === 'string' && task.title.trim().length > 0 && task.title.length <= 200
    && (task.dueDate === null || validDate(task.dueDate))
    && validTimestamp(task.createdAt) && validUsername(task.createdBy)
    && ((task.completedAt === null && task.completedBy === null)
      || (validTimestamp(task.completedAt) && validUsername(task.completedBy)));
}

export function validateTasks(tasks) {
  if (!Array.isArray(tasks)) return false;
  const ids = new Set();
  for (const task of tasks) {
    if (!validTask(task) || ids.has(task.id)) return false;
    ids.add(task.id);
  }
  return true;
}

function checkedTasks(tasks) {
  const current = tasks === undefined ? [] : tasks;
  if (!validateTasks(current)) invalid('A lista de tarefas existente é inválida.');
  return current;
}

export function createTask(existingTasks, input, actor, nowISO) {
  const tasks = checkedTasks(existingTasks);
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || typeof input.title !== 'string' || !input.title.trim() || input.title.trim().length > 200
    || !(input.dueDate === undefined || input.dueDate === null || input.dueDate === '' || validDate(input.dueDate))) {
    invalid('Informe um título de até 200 caracteres e uma data válida, se desejar.');
  }
  if (!validUsername(actor) || !validTimestamp(nowISO)) invalid('Autor ou horário da tarefa inválido.');
  let id;
  do { id = randomUUID(); } while (tasks.some(task => task.id === id));
  const task = {
    id,
    title: input.title.trim(),
    dueDate: input.dueDate || null,
    createdAt: nowISO,
    createdBy: actor,
    completedAt: null,
    completedBy: null
  };
  return [...tasks.map(item => ({ ...item })), task];
}

export function completeTask(existingTasks, id, actor, nowISO) {
  const tasks = checkedTasks(existingTasks);
  if (typeof id !== 'string' || !id || !validUsername(actor) || !validTimestamp(nowISO)) invalid('Tarefa ou horário inválido.');
  const target = tasks.find(task => task.id === id);
  if (!target) invalid('A tarefa não foi encontrada nesta conta.');
  if (target.completedAt !== null) return tasks.map(item => ({ ...item }));
  return tasks.map(task => task.id === id
    ? { ...task, completedAt: nowISO, completedBy: actor }
    : { ...task });
}
