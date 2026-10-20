import { readFile } from 'node:fs/promises';
import { neon } from '@neondatabase/serverless';

if (!process.env.DATABASE_URL) {
  console.error('Configure DATABASE_URL antes de inicializar o banco.');
  process.exit(1);
}

try {
  const sql = neon(process.env.DATABASE_URL);
  // schema.sql contains only simple DDL statements, without SQL functions.
  const schema = await readFile(new URL('../schema.sql', import.meta.url), 'utf8');
  const statements = schema.split(';').map(s => s.trim()).filter(Boolean);
  await sql.transaction(statements.map(statement => sql.query(statement)));
  const tables = await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('studio_accounts', 'studio_sessions')
    ORDER BY table_name
  `;
  if (tables.length !== 2) throw new Error('Missing tables');
  console.log('Schema inicializado: studio_accounts e studio_sessions.');
} catch (error) {
  console.error('Falha ao inicializar o schema. Verifique a conexão e as permissões. Código:', error.code || 'indisponível');
  process.exitCode = 1;
}
