// Declarative event commands accept literal arguments only. Never evaluate JS.
export function parseCommands(source){
 if(typeof source!=='string'||source.length>3000)throw Error('Ação inválida.');
 source=source.replace(/^\s*event\.preventDefault\(\);\s*/,'');
 let cursor=0;
 const whitespace=()=>{while(/\s/.test(source[cursor]||'')&&cursor<source.length)cursor++};
 function literal(){
  whitespace();const quote=source[cursor];
  if(quote==='"'||quote==="'"){
   cursor++;let value='';
   while(cursor<source.length){
    const char=source[cursor++];if(char===quote)return value;
    if(char!=='\\'){value+=char;continue}
    const next=source[cursor++];
    if(next==='u'){
     const hex=source.slice(cursor,cursor+4);if(!/^[a-f\d]{4}$/i.test(hex))throw Error('Argumento inválido.');
     value+=String.fromCharCode(parseInt(hex,16));cursor+=4;
    }else if(Object.hasOwn({n:1,r:1,t:1,b:1,f:1},next))value+=({n:'\n',r:'\r',t:'\t',b:'\b',f:'\f'})[next];
    else if(next==='\\'||next==='"'||next==="'"||next==='/')value+=next;
    else throw Error('Argumento inválido.');
   }
   throw Error('Texto incompleto.');
  }
  const token=source.slice(cursor).match(/^(true|false|null|[+-]?(?:\d+(?:\.\d+)?))/)?.[0];
  if(!token)throw Error('Somente argumentos literais são permitidos.');
  cursor+=token.length;
  return token==='true'?true:token==='false'?false:token==='null'?null:Number(token);
 }
 const commands=[];
 while(cursor<source.length){
  whitespace();if(source[cursor]===';'){cursor++;continue}if(cursor===source.length)break;
  const name=source.slice(cursor).match(/^[A-Za-z_$][\w$]*/)?.[0];if(!name)throw Error('Ação inválida.');cursor+=name.length;whitespace();
  if(source[cursor++]!=='(')throw Error('Ação inválida.');whitespace();const args=[];
  if(source[cursor]!==')')while(true){args.push(literal());whitespace();if(args.length>8)throw Error('Argumentos demais.');if(source[cursor]!==',')break;cursor++}
  if(source[cursor++]!==')')throw Error('Ação inválida.');whitespace();
  if(cursor<source.length&&source[cursor]!==';')throw Error('Ação inválida.');
  commands.push({name,args});if(commands.length>10)throw Error('Ações demais.');
 }
 return commands;
}

export function installActionEvents({document,actions,allow,onError}){
 const listeners=[];
 for(const type of ['click','submit','input','change']){
  const listener=async event=>{
   const selector='[data-on'+type+']',node=event.target?.closest?.(selector);
   if(!node)return;
   if(type==='click'&&node.getAttribute('data-onclick')==='closeModalBackdrop()'&&event.target!==node)return;
   if(type==='click'||type==='submit')event.preventDefault();
   try{
    for(const command of parseCommands(node.getAttribute('data-on'+type))){
     if(!Object.hasOwn(actions,command.name)||!allow(command.name))return;
     await actions[command.name](...command.args,...(command.name==='removeExpenseLine'||command.name==='closeModalBackdrop'?[node,event]:[]));
    }
   }catch(error){onError(error)}
  };
  document.addEventListener(type,listener);listeners.push([type,listener]);
 }
 return()=>listeners.forEach(([type,listener])=>document.removeEventListener(type,listener));
}
