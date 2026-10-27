const {app,BrowserWindow,dialog,ipcMain,Menu,shell}=require('electron');
const{spawn}=require('node:child_process');const fs=require('node:fs/promises');const path=require('node:path');const os=require('node:os');
let window,worker,endpoint,owned=false,quitting=false;
const isolated=process.env.FILMMA_DESKTOP_TEST_DATA;
const resources=app.isPackaged?process.resourcesPath:path.resolve(__dirname,'../build/desktop-resources');
const allowedExternal=url=>{try{const u=new URL(url);return u.protocol==='https:'&&['github.com','huggingface.co','docs.astral.sh','developer.apple.com','support.apple.com'].includes(u.hostname)}catch{return false}};
async function request(url){return fetch(url,{signal:AbortSignal.timeout(5000)}).then(r=>r.ok?r.json():null).catch(()=>null)}
async function engine(){
 const shared=isolated?null:await request('http://127.0.0.1:4318/api/application');
 if(shared?.id==='filmma-studio'){endpoint='http://127.0.0.1:4318';return}
 const home=isolated?path.resolve(isolated):path.join(app.getPath('userData'),'studio');let root=path.join(home,'engine'),data=path.join(home,'data');
 const existing=path.join(app.getPath('documents'),'Filmma IA');
 const useExisting=!isolated&&await fs.access(path.join(existing,'runtime/filmma_runtime.py')).then(()=>fs.access(path.join(existing,'data/project.json'))).then(()=>true).catch(()=>false);
 if(useExisting){root=existing;data=path.join(existing,'data')}
 await fs.mkdir(root,{recursive:true});
 // Refresh only application-owned adapter code. Never replace weights, config,
 // models, vendor checkouts, generated media or user projects during updates.
 if(!useExisting)for(const name of ['runtime','desktop'])await fs.cp(path.join(resources,'engine',name),path.join(root,name),{recursive:true,force:true});
 const binaries=path.join(resources,'bin');const environment={...process.env,PATH:[binaries,'/opt/homebrew/bin','/usr/local/bin',path.join(os.homedir(),'.local/bin'),process.env.PATH].filter(Boolean).join(path.delimiter),ELECTRON_RUN_AS_NODE:'1',FILMMA_DESKTOP:'1',FILMMA_ROOT:root,FILMMA_DATA_DIR:path.join(home,'data'),FILMMA_DIST_DIR:path.join(resources,'dist'),FILMMA_PUBLIC_DIR:path.join(resources,'public'),FILMMA_PYTHON:path.join(resources,'python/bin/python3.12'),FILMMA_FFMPEG:path.join(binaries,'ffmpeg'),FILMMA_FFPROBE:path.join(binaries,'ffprobe'),FILMMA_GH:path.join(binaries,'gh'),FILMMA_PORT:isolated?'4320':'4318'};
 environment.FILMMA_DATA_DIR=data;
 endpoint=`http://127.0.0.1:${environment.FILMMA_PORT}`;
 await fs.mkdir(path.join(home,'logs'),{recursive:true});const log=await fs.open(path.join(home,'logs','application.log'),'a',0o600);
 worker=spawn(process.execPath,[path.join(resources,'server','index.mjs')],{env:environment,stdio:['ignore',log.fd,log.fd]});owned=true;
 await log.close();
 let ended;worker.on('exit',code=>{ended=code??-1});
 for(let i=0;i<120;i++){if(ended!==undefined)throw new Error(`El motor local terminó (${ended}). Revisa ${home}/logs/application.log`);const state=await request(endpoint+'/api/application');if(state?.id==='filmma-studio')return;await new Promise(r=>setTimeout(r,500))}
 throw new Error('El motor local no respondió a tiempo. Tus proyectos se conservan.');
}
async function createWindow(){
 window=new BrowserWindow({width:1480,height:980,minWidth:420,minHeight:620,backgroundColor:'#171a19',title:'Filmma',titleBarStyle:'default',show:false,webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true}});
 window.webContents.setWindowOpenHandler(({url})=>{if(allowedExternal(url))void shell.openExternal(url);return{action:'deny'}});
 window.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith(endpoint+'/'))event.preventDefault()});
 window.on('close',async event=>{if(quitting||!owned)return;event.preventDefault();const state=await request(endpoint+'/api/jobs');if(state?.jobs?.some(j=>['queued','running'].includes(j.status))){window.hide();return}quitting=true;app.quit()});
 window.on('closed',()=>{window=undefined});
 await window.loadURL(endpoint);window.show();
}
ipcMain.handle('filmma:choose-directory',async()=>{const r=await dialog.showOpenDialog(window,{properties:['openDirectory','createDirectory'],buttonLabel:'Elegir carpeta del modelo'});return r.canceled?null:r.filePaths[0]});
ipcMain.handle('filmma:version',()=>app.getVersion());
ipcMain.handle('filmma:open-external',async(_event,url)=>{if(!allowedExternal(url))throw new Error('Destino no permitido');await shell.openExternal(url)});
if(!app.requestSingleInstanceLock())app.quit();else{
 app.on('second-instance',()=>{window?.show();window?.focus()});
 app.whenReady().then(async()=>{
  Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'Filmma',submenu:[{role:'about'},{label:'Configuración…',accelerator:'CmdOrCtrl+,',click:()=>window?.webContents.send('filmma:settings')},{type:'separator'},{role:'hide'},{role:'quit'}]},{label:'Editar',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},{label:'Ventana',submenu:[{role:'minimize'},{role:'zoom'},{role:'front'}]}]));
  try{await engine();await createWindow()}catch(e){dialog.showErrorBox('Filmma no pudo abrirse',e.message);quitting=true;app.quit()}
 });
 app.on('activate',()=>{if(window&&!window.isDestroyed())window.show();else if(endpoint)void createWindow()});
 app.on('before-quit',async event=>{if(quitting)return;if(!owned){quitting=true;return}event.preventDefault();const state=await request(endpoint+'/api/jobs');if(state?.jobs?.some(j=>['queued','running'].includes(j.status))){const choice=await dialog.showMessageBox(window,{type:'question',buttons:['Seguir trabajando','Cancelar tareas y salir'],defaultId:0,cancelId:0,message:'Hay tareas en curso',detail:'Puedes dejar Filmma trabajando en segundo plano. Salir cancela las tareas; los originales y descargas parciales se conservan.'});if(choice.response===0){window.hide();return}}quitting=true;worker?.kill('SIGTERM');app.quit()});
 app.on('will-quit',()=>{if(owned)worker?.kill('SIGTERM')});
}
