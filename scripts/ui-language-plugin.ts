import {parse} from '@babel/parser';
import type {Plugin} from 'vite';
// Translate UI literals at build time. User/project strings and payload values
// remain data; no DOM rewriting or translated content is ever saved to a film.
export function uiLanguagePlugin():Plugin{return{name:'filmma-ui-language',enforce:'pre',transform(source,id){
 if(!id.includes('/src/')||!id.endsWith('.tsx')||id.endsWith('/preferences-context.tsx'))return;
 const ast=parse(source,{sourceType:'module',plugins:['typescript','jsx']});const changes:{start:number;end:number;value:string}[]=[];let used=false;
 const call=(value:string)=>{used=true;return `__filmmaT(${JSON.stringify(value)})`};
 const norm=(value:string)=>value.replace(/\s+/g,' ').trim();
 const eligible=(v:string)=>/[A-Za-zÁÉÍÓÚáéíóúñÑ]/.test(v)&&v.trim().length>1;
 const walk=(node:any,parent?:any,key?:string)=>{
  if(!node||typeof node!=='object')return;
  if(node.type==='ObjectProperty'&&!node.computed&&['label','title','text','hint','description'].includes(node.key?.name)&&node.value?.type==='StringLiteral'&&eligible(norm(node.value.value))){changes.push({start:node.value.start,end:node.value.end,value:call(node.value.value)});return}
  if(node.type==='CallExpression'&&node.callee?.name==='notify'&&node.arguments?.[0]?.type==='StringLiteral'&&eligible(node.arguments[0].value)){const n=node.arguments[0];changes.push({start:n.start,end:n.end,value:call(n.value)});return}
  if(node.type==='JSXText'&&eligible(norm(node.value))){const leading=/^\s/.test(node.value)?' ':'';const trailing=/\s$/.test(node.value)?' ':'';changes.push({start:node.start,end:node.end,value:`${leading}{${call(norm(node.value))}}${trailing}`});return}
  if(node.type==='JSXAttribute'&&['label','title','aria-label','placeholder','alt','hint','text'].includes(node.name?.name)&&node.value?.type==='StringLiteral'&&eligible(node.value.value)){changes.push({start:node.value.start,end:node.value.end,value:`{${call(norm(node.value.value))}}`});return}
  // Only literal branches of JSX child expressions; never values in handlers,
  // input value attributes, data objects or identifier comparisons.
  if(node.type==='JSXExpressionContainer'&&(parent?.type!=='JSXAttribute'||['label','title','aria-label','placeholder','alt','hint','text'].includes(parent.name?.name))){
   const expression=(n:any)=>{
    if(!n)return;
    if(n.type==='StringLiteral'&&eligible(norm(n.value))){changes.push({start:n.start,end:n.end,value:call(norm(n.value))});return}
    if(n.type==='TemplateLiteral'&&n.quasis.some((q:any)=>eligible(q.value.cooked??''))){const template=n.quasis.map((q:any,i:number)=>(q.value.cooked??'')+(i<n.expressions.length?`{${i}}`:'')).join('');used=true;changes.push({start:n.start,end:n.end,value:`__filmmaF(${JSON.stringify(template)},[${n.expressions.map((e:any)=>source.slice(e.start,e.end)).join(',')}])`});return}
    if(n.type==='ConditionalExpression'){expression(n.consequent);expression(n.alternate)}
    if(n.type==='LogicalExpression')expression(n.right);
   };expression(node.expression);
  }
  for(const[k,v]of Object.entries(node)){if(['loc','start','end','extra','comments'].includes(k))continue;if(Array.isArray(v))v.forEach(item=>walk(item,node,k));else if(v&&typeof v==='object')walk(v,node,k)}
 };walk(ast);
 if(!used)return;let code=source;for(const c of changes.sort((a,b)=>b.start-a.start))code=code.slice(0,c.start)+c.value+code.slice(c.end);
 return{code:`import {t as __filmmaT,tf as __filmmaF} from ${JSON.stringify('/src/i18n')};\n`+code,map:null};
}}}
