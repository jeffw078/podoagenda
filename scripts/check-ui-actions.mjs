import assert from 'node:assert/strict';
import {parseCommands,installActionEvents} from '../ui-actions.js';

assert.deepEqual(parseCommands('event.preventDefault();closeModal();openClient("Ana \\"Silva\\"",-1,true,null)'),[
 {name:'closeModal',args:[]},{name:'openClient',args:['Ana "Silva"',-1,true,null]}
]);
assert.deepEqual(parseCommands("saveClient('id\\u0031');"),[{name:'saveClient',args:['id1']}]);
for(const source of ['window.openClient()','openClient(db)','openClient({})','openClient([])','openClient(this.value)','profile="podo"','openClient();(()=>alert(1))()','openClient("unterminated)','a(1e10)','a(NaN)','a(1,2,3,4,5,6,7,8,9)','a();'.repeat(11),'x'.repeat(3001)])assert.throws(()=>parseCommands(source),source);

const listeners=new Map(),calls=[],errors=[];
const document={addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:type=>listeners.delete(type)};
let allowed=false;
const remove=installActionEvents({document,actions:{openClient:id=>calls.push(id),closeModalBackdrop:(node,event)=>calls.push([node,event])},allow:()=>allowed,onError:error=>errors.push(error)});
function event(source){const node={getAttribute:()=>source};return {target:{closest:()=>node},preventDefault(){this.prevented=true},node}}
let input=event('openClient("private")');await listeners.get('click')(input);assert.equal(input.prevented,true);assert.deepEqual(calls,[],'Unauthorized commands cannot invoke actions');
allowed=true;input=event('openClient("authorized")');await listeners.get('submit')(input);assert.equal(input.prevented,true);assert.deepEqual(calls,['authorized']);
await listeners.get('click')(event('constructor("return globalThis")'));assert.equal(calls.length,1,'Inherited object functions never execute');
await listeners.get('click')(event('openClient("safe");profile="podo"'));assert.equal(calls.length,1,'Parse entire command before executing any action');assert.equal(errors.length,1);
input=event('closeModalBackdrop()');await listeners.get('click')(input);assert.equal(input.prevented,undefined,'Clicks inside modal preserve native checkbox/input actions');
input=event('closeModalBackdrop()');input.target=input.node;input.target.closest=()=>input.node;await listeners.get('click')(input);assert.deepEqual(calls[1],[input.node,input]);
remove();assert.equal(listeners.size,0);
console.log('OK: literal action parser, injection rejection, capability guards, event handling and cleanup.');
