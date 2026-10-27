/** Isolated editor fixture. Never opens, edits or generates media for the user's movie. */
import {createApp} from '../server/app.ts';
import {createSeedProject} from '../server/seed.ts';
import {mkdir,access,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const evidence=join(root,'output/qa/editable-settings');
const dataDirectory=join(evidence,'store');
await mkdir(dataDirectory,{recursive:true});
const projectFile=join(dataDirectory,'project.json');
if(!await access(projectFile).then(()=>true,()=>false)){
 const project=createSeedProject();
 project.id='qa-editable-settings';project.name='Prueba de duración y salida';
 project.logline='Proyecto aislado para comprobar los controles. No contiene nuevas generaciones.';
 project.scenes=project.scenes.slice(0,2).map(scene=>({...scene,duration:3}));
 await writeFile(projectFile,JSON.stringify(project,null,2));
}
const fixture=await createApp({dataDirectory,distDirectory:join(evidence,'dist'),credentialsDirectory:join(evidence,'private-test-connection'),skipDiagnostics:true});
const server=fixture.app.listen(5173,'127.0.0.1',()=>console.log('Prueba aislada de controles: http://127.0.0.1:5173/'));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,async()=>{await fixture.close();server.close();});
