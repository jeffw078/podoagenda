const failures = {
  DATABASE_URL_MISSING: 'A conexão com o banco ainda não foi configurada. Solicite a configuração ao responsável pelo sistema.',
  DATABASE_URL_INVALID: 'A conexão com o banco está configurada em um formato inválido. Solicite a correção ao responsável pelo sistema.',
  DATABASE_AUTH_FAILED: 'O banco recusou as credenciais de conexão. O responsável precisa atualizar a conexão do sistema.',
  DATABASE_ACCESS_DENIED: 'O sistema não tem permissão para acessar o banco. Solicite a revisão do acesso ao responsável.',
  DATABASE_SCHEMA_MISSING: 'O banco conectado ao sistema ainda não tem as tabelas necessárias. Solicite a inicialização desse banco ao responsável.',
  DATABASE_SCHEMA_OUTDATED: 'A estrutura do banco conectado precisa ser atualizada. Solicite a revisão ao responsável pelo sistema.',
  DATABASE_NOT_FOUND: 'O banco configurado não foi encontrado. Solicite a revisão da conexão ao responsável pelo sistema.',
  DATABASE_UNAVAILABLE: 'Não foi possível conectar ao banco neste momento. Tente novamente em instantes.',
};

export function readDatabaseUrl(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) throw Object.assign(new Error('Missing database configuration'), {code:'DATABASE_URL_MISSING'});
  let parsed;
  try { parsed = new URL(raw); } catch { /* Invalid configuration is reported below. */ }
  if (!parsed || !['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname || !parsed.username || !parsed.password || parsed.pathname.length < 2) {
    throw Object.assign(new Error('Invalid database configuration'), {code:'DATABASE_URL_INVALID'});
  }
  return raw;
}

export function databaseFailure(error) {
  const upstream = String(error?.code || error?.cause?.code || '');
  let code = Object.hasOwn(failures, upstream) ? upstream : ({
    '28P01':'DATABASE_AUTH_FAILED', '28000':'DATABASE_AUTH_FAILED',
    '42501':'DATABASE_ACCESS_DENIED', '42P01':'DATABASE_SCHEMA_MISSING',
    '42703':'DATABASE_SCHEMA_OUTDATED', '3D000':'DATABASE_NOT_FOUND',
  })[upstream];
  if (!code && (/^(08|53|57)/.test(upstream) || ['ENOTFOUND','ECONNREFUSED','ECONNRESET','ETIMEDOUT','EAI_AGAIN','UND_ERR_CONNECT_TIMEOUT'].includes(upstream) || /fetch failed|error connecting to database|failed to fetch|timeout|network error/i.test(String(error?.message)))) {
    code = 'DATABASE_UNAVAILABLE';
  }
  return code ? {status:503,code,error:failures[code]} : null;
}
