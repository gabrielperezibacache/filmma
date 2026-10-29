import {MAX_SOURCE_CHARACTERS} from '../src/source-reading.js';
import {extname} from 'node:path';
import {unzipSync} from 'fflate';
import {DOMParser} from '@xmldom/xmldom';
export const SOURCE_EXTENSIONS=['pdf','docx','doc','odt','rtf','txt','md','csv','json','html','htm','fountain','srt','vtt'];
export async function extractSource(buffer:Buffer,name:string):Promise<{text:string;pages?:number;warnings:string[]}>{
 const ext=extname(name).slice(1).toLowerCase();if(!SOURCE_EXTENSIONS.includes(ext))throw new Error('Formato no admitido. Usa PDF, Word, ODT, RTF o texto.');
 if(buffer.length>20*1024**2)throw new Error('El documento supera 20 MiB. Divide el original en secciones.');
 let text='',pages:number|undefined;const warnings:string[]=[];
 if(ext==='pdf'){
  if(buffer.subarray(0,5).toString()!=='%PDF-')throw new Error('El archivo no contiene un PDF válido.');
  const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');const loading=getDocument({data:new Uint8Array(buffer),useSystemFonts:false,disableFontFace:true,verbosity:0});
  try{const pdf=await loading.promise;pages=pdf.numPages;if(pages>500)throw new Error('Máximo 500 páginas por documento; divídelo en partes.');for(let p=1;p<=pages;p++){const page=await pdf.getPage(p),content=await page.getTextContent();text+=`\n[Página ${p}]\n`+content.items.map(i=>'str'in i?i.str+('hasEOL'in i&&i.hasEOL?'\n':' '):'').join('');if(text.length>MAX_SOURCE_CHARACTERS)throw new Error('El texto supera 1.000.000 caracteres; divide el documento para adaptarlo completo.');page.cleanup();}if(text.replace(/\[Página \d+\]/g,'').trim().length<20)throw new Error('Este PDF no contiene suficiente texto legible. Aplica OCR al documento y vuelve a incorporarlo; el original no se modifica.');}finally{await loading.destroy();}
 }else if(ext==='doc'){
  if(buffer.subarray(0,8).toString('hex')!=='d0cf11e0a1b11ae1')throw new Error('El archivo no contiene un documento Word .doc válido.');
  const {default:WordExtractor}=await import('word-extractor');const doc=await new WordExtractor().extract(buffer);text=doc.getBody();
 }else if(ext==='docx'||ext==='odt'){
  let expanded=0,count=0;const zip=unzipSync(buffer,{filter:file=>{expanded+=file.originalSize;count++;if(expanded>40*1024**2||count>2000)throw new Error('El documento comprimido supera el límite de lectura.');return file.name===(ext==='docx'?'word/document.xml':'content.xml');}});const xml=zip[ext==='docx'?'word/document.xml':'content.xml'];if(!xml)throw new Error('No se encontró el texto de este documento.');
  if(ext==='docx'){const {extractRawText}=await import('mammoth');text=(await extractRawText({buffer})).value;}else{const source=new TextDecoder().decode(xml);if(/<!DOCTYPE|<!ENTITY/i.test(source))throw new Error('El documento contiene entidades externas no admitidas.');const doc=new DOMParser().parseFromString(source,'text/xml');text=Array.from(doc.getElementsByTagName('*')).filter(n=>/(^|:)(p|h)$/.test(n.tagName)).map(n=>n.textContent??'').join('\n');}
 }else{
  const decoder=new TextDecoder(buffer[0]===255&&buffer[1]===254?'utf-16le':'utf-8',{fatal:true});try{text=decoder.decode(buffer);}catch{throw new Error('No se pudo leer el texto. Guárdalo con codificación UTF-8.');}
  if(text.includes('\0'))throw new Error('El archivo contiene datos binarios, no texto.');
  if(ext==='rtf'){text=text.replace(/\{\\(?:fonttbl|colortbl|stylesheet)[\s\S]*?\}/g,'').replace(/\\par\b/g,'\n').replace(/\\u(-?\d+)\??/g,(_,n)=>String.fromCharCode(Number(n)&65535)).replace(/\\'[a-f0-9]{2}/gi,m=>Buffer.from([parseInt(m.slice(2),16)]).toString('latin1')).replace(/\\[a-z]+-?\d* ?/gi,'').replace(/[{}]/g,'');warnings.push('RTF: comprueba acentos y saltos de párrafo en la vista de texto.');}
  if(ext==='html'||ext==='htm'){text=text.replace(/<script[\s\S]*?<\/script>/gi,'').replace(/<style[\s\S]*?<\/style>/gi,'').replace(/<(?:br|\/p|\/div|\/h\d)\b[^>]*>/gi,'\n').replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');}
 }
 text=text.trim();if(!text)throw new Error('El documento no contiene texto legible.');if(text.length>MAX_SOURCE_CHARACTERS)throw new Error('El texto supera 1.000.000 caracteres. Divide el documento; no se recortará silenciosamente.');return {text,pages,warnings};
}
