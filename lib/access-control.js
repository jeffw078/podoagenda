const clinicalKeys = ['clients', 'services', 'appointments', 'settings'];
const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);

export function capabilitiesFor(account) {
  return {finance:true, clinic:account.profile === 'podo', admin:account.profile === 'personal' && account.username === 'jefferson'};
}

export function financialView(data) {
  return {transactions:data?.transactions || [], ...(data?.finance !== undefined ? {finance:data.finance} : {})};
}

export function dataView(account) {
  return account.profile === 'podo' ? account.data : financialView(account.data);
}

export function hasClinicalWrite(body) {
  return clinicalKeys.some(key => own(body, key) || own(body?.data, key));
}

export function mergeFinancialData(previous, incoming) {
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming) || Object.keys(incoming).some(key => !['transactions', 'finance'].includes(key)) || !own(incoming, 'transactions')) return null;
  const merged = {...previous, transactions:incoming.transactions};
  if (own(incoming, 'finance')) merged.finance = incoming.finance;
  else delete merged.finance;
  return merged;
}

export function adminAccountView(account) {
  const clinic = account.profile === 'podo', appointmentCounts = {};
  if (clinic) for (const appointment of account.data?.appointments || []) {
    if (appointment.status === 'cancelado' || typeof appointment.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(appointment.date)) continue;
    const month = appointment.date.slice(0, 7);
    appointmentCounts[month] = (appointmentCounts[month] || 0) + 1;
  }
  return {profile:account.profile, username:account.username, revision:account.revision,
    data:financialView(account.data),
    configuration:{clinicSchedule:clinic ? account.data?.settings || null : null, serviceCatalog:clinic ? account.data?.services || [] : []},
    appointmentCounts};
}

export function validAnamnesis(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const fields = ['diabetes', 'hypertension', 'circulationProblems', 'anticoagulants', 'allergies'];
  return Object.keys(value).every(key => fields.includes(key)) && ['none', 'type1', 'type2'].includes(value.diabetes)
    && ['hypertension', 'circulationProblems', 'anticoagulants'].every(key => typeof value[key] === 'boolean')
    && typeof value.allergies === 'string' && value.allergies.length <= 2000;
}
