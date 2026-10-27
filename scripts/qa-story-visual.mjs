import {chromium} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
const round=process.env.FILMMA_STORY_ROUND||'1';if(!['1','2'].includes(round))throw Error('Maximum two visual rounds');
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true}),report=[];
try{for(const [device,viewport] of [['desktop',{width:1440,height:1100}],['mobile',{width:390,height:844}]]){
 const context=await browser.newContext({viewport,locale:'es-CL',reducedMotion:'reduce'}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',async route=>{if(['GET','HEAD'].includes(route.request().method()))await route.continue();else await route.abort()});
 await page.goto(process.env.FILMMA_QA_URL||'http://127.0.0.1:4317');await page.getByRole('heading',{name:/La sala de montaje/}).waitFor();
 const nav=name=>page.getByRole('navigation',{name:'Secciones del estudio'}).getByRole('button',{name,exact:true});
 for(const surface of ['editor','script','reading','continuity']){
  if(surface==='script'){await nav('Guion').click()}
  if(surface==='reading'){await page.getByRole('tab',{name:'Leer',exact:true}).click()}
  if(surface==='continuity'){await nav('Estudio').click();await page.locator('.shot-card').nth(1).click();await page.getByRole('button',{name:'Continuidad',exact:true}).click()}
  await page.evaluate(()=>document.fonts.ready);await page.locator('body').evaluate(()=>window.scrollTo(0,0));
  const metrics=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth}));
  const path=`output/qa/story-${surface}-${device}-r${round}.png`;await page.screenshot({path,fullPage:true,animations:'disabled'});report.push({device,surface,path,metrics,errors:[...errors]});
 }
 await context.close();
}}finally{await browser.close()}
await writeFile(`output/qa/story-visual-r${round}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
