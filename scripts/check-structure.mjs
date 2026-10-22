import assert from 'node:assert/strict';
import {readFile,readdir,stat} from 'node:fs/promises';
import {resolve,relative,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const publicRoot=resolve(root,'public');
const config=JSON.parse(await readFile(resolve(root,'vercel.json'),'utf8'));
assert.equal(config.outputDirectory,'public','Only browser assets may be served statically');
assert.equal(config.buildCommand,'npm run build');
const allowed=new Set([
 'index.html','manifest.json','apple-touch-icon.png','icons/icon-192.png','icons/icon-512.png','icons/favicon-32.png',
 ...['app.bundle.js','finance-browser.js','finance-core.js','finance-insights.js','ui-actions.js','clinic-features.js','tasks-ui.js','finance-ui.css','finance-widgets.css','dashboard-ui.css'].map(file=>'assets/'+file),
 ...['common','personal','clinic','admin'].map(file=>'views/'+file+'.html')
]);
async function files(directory){
 const result=[];
 for(const entry of await readdir(directory,{withFileTypes:true})){
  assert.equal(entry.isSymbolicLink(),false,'Public assets must not link to private files');
  if(entry.isDirectory())result.push(...await files(join(directory,entry.name)));
  else result.push(join(directory,entry.name));
 }
 return result;
}
const published=await files(publicRoot);
assert.deepEqual(new Set(published.map(file=>relative(publicRoot,file).replaceAll('\\','/'))),allowed,'Public output must not contain source, docs, credentials or backups');
const html=await readFile(join(publicRoot,'index.html'),'utf8');
assert.match(html,/type="module" src="\/assets\/app\.bundle\.js/);
assert.doesNotMatch(html,/\son(?:click|submit|input|change)=/,'Inline JS handlers are not used');
for(const match of html.matchAll(/(?:src|href)="(\/[^"?#]+)[^\"]*"/g))assert.ok((await stat(join(publicRoot,match[1]))).isFile(),'Missing public resource '+match[1]);
for(const file of published.filter(file=>file.endsWith('.js'))){
 const text=await readFile(file,'utf8');
 for(const match of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"](\.[^'"]+)['"]/g)){
  const target=resolve(dirname(file),match[1]);
  assert.ok(!relative(publicRoot,target).startsWith('..'),'Browser imports must stay inside public');
  assert.ok((await stat(target)).isFile(),'Missing browser import '+match[1]);
 }
}
assert.doesNotMatch(await readFile(join(publicRoot,'assets/app.bundle.js'),'utf8'),/\son(?:click|submit|input|change)=/,'Generated templates use delegated actions');
console.log('OK: public output excludes private/source files; HTML, styles and module dependencies resolve.');
