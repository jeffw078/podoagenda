import { readFile } from 'node:fs/promises';

const loadSchema = () => readFile(new URL('../schema.sql', import.meta.url), 'utf8');

export function schemaAwareSql(client, readSchema = loadSchema) {
  let initialization;
  return async (...args) => {
    try {
      return await client(...args);
    } catch (error) {
      if (error.code !== '42P01') throw error;
      if (!initialization) {
        initialization = (async () => {
          const schema = await readSchema();
          // The application schema contains simple CREATE statements only.
          const statements = schema.split(';').map(statement => statement.trim()).filter(Boolean);
          await client.transaction(statements.map(statement => client.query(statement)));
        })().catch(failure => {
          initialization = undefined;
          throw failure;
        });
      }
      await initialization;
      // Retry once. Further errors are reported to the caller without a loop.
      return client(...args);
    }
  };
}
