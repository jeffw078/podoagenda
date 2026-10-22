import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = dirname(scriptsDirectory);
const checkScripts = readdirSync(scriptsDirectory)
  .filter((name) => /^check-.*\.mjs$/.test(name) && name !== 'check-browser.mjs')
  .sort();

for (const name of checkScripts) {
  const result = spawnSync(process.execPath, [join(scriptsDirectory, name)], {
    cwd: repositoryRoot,
    stdio: 'inherit',
    shell: false,
  });

  if (result.error) {
    console.error(`Could not run ${name}: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
console.log(`All ${checkScripts.length} local checks passed.`);
