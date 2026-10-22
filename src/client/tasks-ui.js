// Task views use the server-backed task list supplied by app.js.
export function createTasksFeature(ctx) {
  const {$, esc, modal} = ctx;
  const authorized = () => ctx.requireFinance() === true;
  const notify = message => (ctx.alert || globalThis.alert)(message);
  let taskList = [], revision = null, busy = false;
  const epochNow = () => typeof ctx.getEpoch === 'function' ? ctx.getEpoch()
    : typeof ctx.sessionEpoch === 'function' ? ctx.sessionEpoch() : ctx.sessionEpoch;
  const current = epoch => authorized() && (epoch === undefined || epochNow() === epoch);
  const dateLabel = value => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return '';
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day, 12).toLocaleDateString('pt-BR');
  };
  const timestampLabel = value => {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short'
    }).format(date);
  };
  const actionArgument = value => esc(JSON.stringify(String(value)));

  function taskRows() {
    const rows = [...taskList].sort((a, b) => {
      if (a.completedAt !== null && b.completedAt === null) return 1;
      if (a.completedAt === null && b.completedAt !== null) return -1;
      return (a.dueDate || '9999-12-31').localeCompare(b.dueDate || '9999-12-31')
        || a.createdAt.localeCompare(b.createdAt);
    });
    if (!rows.length) return '<p class="empty">Nenhuma tarefa cadastrada.</p>';
    return rows.map(task => {
      const done = task.completedAt !== null;
      const due = task.dueDate ? ` · Prazo ${esc(dateLabel(task.dueDate))}` : '';
      const completion = done
        ? `<small class="muted">Concluída por ${esc(task.completedBy)} · ${esc(timestampLabel(task.completedAt))}</small>`
        : '';
      return `<label class="task-row"><input type="checkbox" ${done ? 'checked disabled' : ''} data-onchange="completeTask(${actionArgument(task.id)})" aria-label="Concluir ${esc(task.title)}"><span class="task-row-content"><strong>${esc(task.title)}</strong><small class="muted">Criada por ${esc(task.createdBy)}${due}</small>${completion}</span></label>`;
    }).join('');
  }

  function renderTasks() {
    modal('Tarefas', `<div class="actions" style="justify-content:flex-end;margin-bottom:8px"><button type="button" class="btn small" data-onclick="openNewTask()" aria-label="Adicionar tarefa" title="Adicionar tarefa"><span aria-hidden="true">＋</span></button></div><div class="task-list">${taskRows()}</div>`);
  }

  function renderTaskForm(title = '', dueDate = '') {
    modal('Nova tarefa', `<form class="fields" data-onsubmit="saveTask()"><label class="field">Tarefa<input id="taskTitle" type="text" maxlength="200" value="${esc(title)}" required></label><label class="field">Prazo (opcional)<input id="taskDueDate" type="date" value="${esc(dueDate)}"></label><button type="submit" class="btn full">Salvar</button><button type="button" class="btn outline full" data-onclick="openTasks()">Cancelar</button></form>`);
  }

  function openNewTask() {
    if (!authorized() || busy || revision === null) return;
    renderTaskForm();
  }

  async function reload(epoch) {
    const result = await ctx.loadTasks();
    if (!current(epoch)) return false;
    if (!result || !Array.isArray(result.tasks) || !Number.isInteger(result.revision)) throw Error('Resposta inválida da lista de tarefas.');
    taskList = result.tasks;
    revision = result.revision;
    return true;
  }

  async function openTasks() {
    if (!authorized()) return;
    const epoch = epochNow();
    try {
      if (await reload(epoch) && current(epoch)) renderTasks();
    } catch (error) { if (current(epoch)) notify(error?.message || 'Não foi possível carregar as tarefas.'); }
  }

  async function saveTask() {
    if (!authorized() || busy) return;
    const epoch = epochNow();
    busy = true;
    const restoreForm = (title, dueDate) => {
      renderTaskForm(title, dueDate);
    };
    try {
      const title = $('taskTitle')?.value?.trim() || '';
      const dueDate = $('taskDueDate')?.value || null;
      if (!title || title.length > 200) throw Error('Informe uma tarefa com até 200 caracteres.');
      const result = await ctx.mutateTask('tasksCreate', { title, dueDate, revision });
      if (!current(epoch)) return;
      if (!result || !Array.isArray(result.tasks) || !Number.isInteger(result.revision)) throw Error('Resposta inválida ao salvar a tarefa.');
      taskList = result.tasks;
      revision = result.revision;
      renderTasks();
    } catch (error) {
      if (!current(epoch)) return;
      const title = $('taskTitle')?.value || '', dueDate = $('taskDueDate')?.value || '';
      if (error?.status === 409 || error?.code === 'REVISION_CONFLICT') {
        try { if (await reload(epoch)) restoreForm(title, dueDate); }
        catch { if (current(epoch)) restoreForm(title, dueDate); }
      }
      notify(error?.message || 'Não foi possível adicionar a tarefa.');
    } finally { busy = false; }
  }

  async function completeTask(id) {
    if (!authorized() || busy) return;
    const epoch = epochNow();
    busy = true;
    try {
      const result = await ctx.mutateTask('tasksComplete', { id, revision });
      if (!current(epoch)) return;
      if (!result || !Array.isArray(result.tasks) || !Number.isInteger(result.revision)) throw Error('Resposta inválida ao concluir a tarefa.');
      taskList = result.tasks;
      revision = result.revision;
      renderTasks();
    } catch (error) {
      if (!current(epoch)) return;
      try { if (!await reload(epoch) && current(epoch)) renderTasks(); }
      catch { if (current(epoch)) renderTasks(); }
      notify(error?.message || 'Não foi possível concluir a tarefa.');
    } finally { busy = false; }
  }

  return { openTasks, openNewTask, saveTask, completeTask };
}
