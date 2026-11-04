/** Materialized appointment recurrences; all changes are prepared before the caller persists. */
const MAX_OCCURRENCES = 366;
const MAX_APPOINTMENTS = 25000;
const clone = value => structuredClone(value);
const fail = message => { throw new Error(message); };

function calendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('Informe uma data válida (AAAA-MM-DD).');
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) fail(`Data inválida: ${value}.`);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date;
}
function daysInMonth(year, month) {
  return [31, (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}
function ruleValues(rule) {
  if (!rule || !['daily', 'weekly', 'monthly'].includes(rule.frequency) || !Number.isInteger(rule.interval) || rule.interval < 1 || rule.interval > 12) fail('Escolha uma frequência e um intervalo de 1 a 12.');
  calendarDate(rule.endDate);
  return { frequency: rule.frequency, interval: rule.interval, endDate: rule.endDate };
}

/** UTC calculations avoid local timezone/DST shifts; monthly dates retain the first day anchor. */
export function recurrenceDates(startDate, rule, anchorDate = startDate) {
  const start = calendarDate(startDate), anchor = calendarDate(anchorDate), normalized = ruleValues(rule);
  if (normalized.endDate < startDate) fail('A data final deve ser igual ou posterior ao primeiro atendimento.');
  const dates = [];
  for (let index = 0; ; index++) {
    let next;
    if (normalized.frequency === 'monthly') {
      const monthIndex = start.getUTCFullYear() * 12 + start.getUTCMonth() + index * normalized.interval;
      const year = Math.floor(monthIndex / 12), month = monthIndex % 12 + 1;
      if (year > 9999) break;
      next = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(Math.min(anchor.getUTCDate(), daysInMonth(year, month))).padStart(2, '0')}`;
    } else {
      const date = new Date(start.getTime() + index * normalized.interval * (normalized.frequency === 'weekly' ? 7 : 1) * 86400000);
      if (date.getUTCFullYear() > 9999) break;
      next = date.toISOString().slice(0, 10);
    }
    // Keep an individually moved selected occurrence; subsequent months use the series anchor.
    if (index === 0) next = startDate;
    if (next > normalized.endDate) break;
    dates.push(next);
    if (dates.length > MAX_OCCURRENCES) fail('A recorrência pode ter no máximo 366 atendimentos. Reduza a data final.');
  }
  return dates;
}

function minutes(value) {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) fail('Informe um horário válido.');
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
}
function appointmentsOf(data) {
  if (!data || !Array.isArray(data.appointments)) fail('Agenda inválida.');
  checkStored(data.appointments);
  return data.appointments;
}
function checkStored(appointments) {
  if (appointments.length > MAX_APPOINTMENTS) fail('A agenda pode ter no máximo 25000 registros.');
  const seen = new Set();
  for (const appointment of appointments) {
    if (!appointment || typeof appointment.id !== 'string' || !appointment.id || seen.has(appointment.id)) fail('A agenda contém identificadores inválidos ou repetidos.');
    seen.add(appointment.id);
  }
}
function checkScope(scope) { if (scope !== 'one' && scope !== 'future') fail('Escolha somente este atendimento ou este e os próximos.'); }
function paidIds(data) { return new Set((data.transactions || []).filter(t => t.type === 'income' && t.appointmentId).map(t => t.appointmentId)); }
function editable(appointment, paid, today) { return appointment.status === 'agendado' && !paid.has(appointment.id) && appointment.date >= today; }
function requireEditable(appointment, paid, today) {
  if (!editable(appointment, paid, today)) fail('Somente atendimentos agendados, sem pagamento e a partir de hoje podem alterar a série. Histórico, cancelamentos e pagamentos são preservados.');
}
function originalDate(appointment) { return appointment.recurrence?.occurrenceDate || appointment.date; }
function candidateShape(record) {
  calendarDate(record.date);
  const start = minutes(record.time);
  if (!Number.isInteger(record.duration) || record.duration <= 0 || start + record.duration > 1440) fail(`Duração inválida em ${record.date} às ${record.time}; o atendimento deve terminar no mesmo dia.`);
  if (!['agendado', 'concluido', 'cancelado'].includes(record.status)) fail('Status inválido.');
  if (record.type === 'personal' && (typeof record.title !== 'string' || !record.title.trim() || record.title.trim().length > 120)) fail('Informe o título do compromisso pessoal.');
  return { start, end: start + record.duration };
}
function validateCandidates(candidates, retained, settings) {
  for (const candidate of candidates) {
    const { start, end } = candidateShape(candidate);
    if (candidate.status === 'cancelado') continue;
    const where = `${candidate.date} às ${candidate.time}`;
    if (candidate.type !== 'personal') {
      if (!settings) fail('Defina os horários de trabalho.');
      const workStart = minutes(settings.start), workEnd = minutes(settings.end), lunchStart = minutes(settings.lunch), lunchDuration = Number(settings.lunchDuration);
      if (!Number.isInteger(lunchDuration) || lunchDuration < 0 || workStart >= workEnd || lunchStart < workStart || lunchStart + lunchDuration > workEnd) fail('Horários de trabalho ou almoço inválidos.');
      if (start < workStart || end > workEnd) fail(`Atendimento fora do horário de trabalho em ${where}.`);
      if (start < lunchStart + lunchDuration && end > lunchStart && lunchDuration > 0) fail(`Conflito com o almoço em ${where}.`);
    }
    for (const other of [...retained, ...candidates]) {
      if (other === candidate || other.status === 'cancelado' || other.date !== candidate.date) continue;
      const otherStart = minutes(other.time), otherEnd = otherStart + Number(other.duration);
      if (start < otherEnd && end > otherStart) fail(`Conflito de horário em ${where} com ${other.type === 'personal' ? 'compromisso pessoal' : 'outro atendimento'} (${other.time}).`);
    }
  }
}
function resetClinical(record) {
  const copy = clone(record);
  copy.status = 'agendado';
  copy.treatmentNotes = '';
  delete copy.completedAt;
  delete copy.notesUpdatedAt;
  delete copy.serviceSnapshot;
  return copy;
}

/** Returns the complete next appointment array without changing data or record. */
export function prepareAppointmentSave(data, { id = '', record, repeat = null, scope = 'one', today }, makeId = () => globalThis.crypto.randomUUID()) {
  const appointments = appointmentsOf(data);
  checkScope(scope);
  calendarDate(today);
  if (!record || typeof record !== 'object' || Array.isArray(record)) fail('Atendimento inválido.');
  const existing = id ? appointments.find(a => a.id === id) : null;
  if (id && !existing) fail('Atendimento não encontrado.');
  const payload = clone(record);
  delete payload.id;
  delete payload.recurrence;
  candidateShape(payload);
  const paid = paidIds(data);
  const used = new Set(appointments.map(a => a.id));
  const allocate = () => {
    const value = makeId();
    if (typeof value !== 'string' || !value || used.has(value)) fail('Não foi possível criar identificadores únicos para a agenda.');
    used.add(value);
    return value;
  };
  const isSeries = Boolean(existing?.recurrence);
  if (isSeries) {
    requireEditable(existing, paid, today);
    if (payload.date < today) fail('A ocorrência da série deve permanecer a partir de hoje; o histórico é preservado.');
  }
  const expanding = Boolean(repeat) || (isSeries && scope === 'future');
  if (!expanding || (isSeries && scope === 'one')) {
    // A one-occurrence edit cannot replace the series rule or original scheduled date.
    const next = { ...(existing ? clone(existing) : {}), ...payload, id: existing?.id || allocate() };
    if (isSeries) next.recurrence = clone(existing.recurrence);
    const retained = appointments.filter(a => a.id !== id);
    validateCandidates([next], retained, data.settings);
    const result = existing ? appointments.map(a => a.id === id ? next : clone(a)) : [...appointments.map(clone), next];
    checkStored(result);
    return { appointments: result, count: 1 };
  }
  if (payload.type === 'personal' || payload.status !== 'agendado' || payload.date < today) fail('Recorrência está disponível somente para atendimentos de clientes agendados a partir de hoje.');
  if (existing) requireEditable(existing, paid, today);
  const rule = ruleValues(repeat || existing.recurrence);
  const unchangedPattern = isSeries && payload.date === existing.date && rule.frequency === existing.recurrence.frequency && rule.interval === existing.recurrence.interval;
  let anchorDate = payload.date;
  if (unchangedPattern) {
    // Existing materialized rows also recover an anchor for legacy metadata.
    anchorDate = existing.recurrence.anchorDate || appointments
      .filter(a => a.recurrence?.id === existing.recurrence.id && a.recurrence.frequency === rule.frequency && a.recurrence.interval === rule.interval)
      .map(originalDate).sort()[0] || originalDate(existing);
  }
  const dates = recurrenceDates(payload.date, rule, anchorDate);
  const pivot = existing ? originalDate(existing) : payload.date;
  if (isSeries) calendarDate(pivot);
  const targets = new Set(existing ? appointments.filter(a => a.id === existing.id || (isSeries && a.recurrence?.id === existing.recurrence.id && originalDate(a) >= pivot && editable(a, paid, today))).map(a => a.id) : []);
  const retained = appointments.filter(a => !targets.has(a.id));
  const protectedDates = new Set(isSeries ? retained.filter(a => a.recurrence?.id === existing.recurrence.id).map(originalDate) : []);
  const seriesId = isSeries ? existing.recurrence.id : allocate();
  const candidates = [];
  for (const date of dates) {
    if (protectedDates.has(date)) continue;
    const candidate = resetClinical(payload);
    candidate.id = candidates.length === 0 && existing ? existing.id : allocate();
    candidate.date = date;
    candidate.recurrence = { id: seriesId, ...rule, occurrenceDate: date, anchorDate };
    candidates.push(candidate);
  }
  if (!candidates.length) fail('Nenhum atendimento pode ser criado sem alterar o histórico protegido.');
  if (retained.length + candidates.length > MAX_APPOINTMENTS) fail('A agenda pode ter no máximo 25000 registros.');
  validateCandidates(candidates, retained, data.settings);
  const result = [...retained.map(clone), ...candidates];
  checkStored(result);
  return { appointments: result, count: candidates.length };
}

/** Cancellations are retained as explicit exceptions; there is no regeneration on read. */
export function prepareAppointmentCancellation(data, { id, scope = 'one', today }) {
  const appointments = appointmentsOf(data);
  checkScope(scope);
  calendarDate(today);
  const selected = appointments.find(a => a.id === id);
  if (!selected) fail('Atendimento não encontrado.');
  const paid = paidIds(data);
  if (selected.recurrence || scope === 'future') requireEditable(selected, paid, today);
  const pivot = originalDate(selected);
  let count = 0;
  const result = appointments.map(appointment => {
    const targeted = appointment.id === id || (scope === 'future' && selected.recurrence && appointment.recurrence?.id === selected.recurrence.id && originalDate(appointment) >= pivot);
    const copy = clone(appointment);
    if (targeted && appointment.status === 'agendado' && !paid.has(appointment.id) && (scope === 'one' || appointment.date >= today)) { copy.status = 'cancelado'; count++; }
    return copy;
  });
  return { appointments: result, count };
}
