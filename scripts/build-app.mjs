import {readFile,writeFile} from 'node:fs/promises';
const sources=await Promise.all(['finance-ui.js','finance-widgets.js','dashboard-ui.js','app.js'].map(file=>readFile(new URL('../'+file,import.meta.url),'utf8')));
const imports="import FinanceCore from './finance-browser.js';\nimport {installActionEvents} from './ui-actions.js';\nimport {createFinanceInsights} from './finance-insights.js';\nimport {createTasksFeature} from './tasks-ui.js';\nconst FinanceInsights=createFinanceInsights(FinanceCore);\n";
const source=imports+sources.join('\n\n')+'\ninstallEvents();\ninitAuth();\n';
const bundle=source.replace(/\bon(click|submit|input|change)=/g,'data-on$1=');
await writeFile(new URL('../app.bundle.js',import.meta.url),bundle);
console.log('Frontend module built with private state and declarative events.');
