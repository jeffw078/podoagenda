import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
const sourceUrl=name=>new URL('../src/client/'+name,import.meta.url);
const outputUrl=name=>new URL('../public/'+name,import.meta.url);
await Promise.all([mkdir(outputUrl('assets/'),{recursive:true}),mkdir(outputUrl('views/'),{recursive:true})]);
const sources=await Promise.all(['finance-ui.js','finance-widgets.js','dashboard-ui.js','app.js'].map(file=>readFile(sourceUrl(file),'utf8')));
const imports="import FinanceCore from './finance-browser.js';\nimport {installActionEvents} from './ui-actions.js';\nimport {createFinanceInsights} from './finance-insights.js';\nimport {createTasksFeature} from './tasks-ui.js';\nconst FinanceInsights=createFinanceInsights(FinanceCore);\n";
const source=imports+sources.join('\n\n')+'\ninstallEvents();\ninitAuth();\n';
const bundle=source.replace(/\bon(click|submit|input|change)=/g,'data-on$1=');
await writeFile(outputUrl('assets/app.bundle.js'),bundle);
const clientAssets=['finance-browser.js','ui-actions.js','clinic-features.js','tasks-ui.js','finance-ui.css','dashboard-ui.css','finance-widgets.css'];
await Promise.all([
 ...clientAssets.map(file=>copyFile(sourceUrl(file),outputUrl('assets/'+file))),
 ...['finance-core.js','finance-insights.js'].map(file=>copyFile(new URL('../src/shared/'+file,import.meta.url),outputUrl('assets/'+file))),
 ...['common','personal','clinic','admin'].map(name=>copyFile(sourceUrl('views/'+name+'.html'),outputUrl('views/'+name+'.html')))
]);
console.log('Frontend built in public/: private application module, assets and authorized views.');
