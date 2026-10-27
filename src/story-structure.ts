import type {Project,StoryScene,StorySequence} from './types';
export function storyContext(project:Project,shotId:string){
 const shot=project.scenes.find(s=>s.id===shotId),scene=project.story?.scenes.find(s=>s.id===shot?.storySceneId),sequence=project.story?.sequences.find(s=>s.id===scene?.sequenceId);
 return{scene,sequence,path:scene?[sequence?.title,scene.title].filter(Boolean).join(' / '):''};
}
export function storyContextText(project:Project,shotId:string){const{path,scene}=storyContext(project,shotId);return[path,scene?.setting,scene?.notes].filter(Boolean).join('\n');}
export function addStorySequence(project:Project,title:string,id:string=crypto.randomUUID()):Project{
 if(!/^[a-zA-Z0-9_-]{1,100}$/.test(id)||!title.trim()||title.length>250)throw Error('Escribe un nombre de secuencia de hasta 250 caracteres.');
 const story=project.story??{sequences:[],scenes:[]};if(story.sequences.length>=100||story.sequences.some(s=>s.id===id))throw Error('No se puede añadir otra secuencia.');
 return{...project,story:{...story,sequences:[...story.sequences,{id,title:title.trim()}]}};
}
export function addStoryScene(project:Project,sequenceId:string,title:string,id:string=crypto.randomUUID()):Project{
 const story=project.story;if(!story?.sequences.some(s=>s.id===sequenceId))throw Error('Elige una secuencia existente.');
 if(!/^[a-zA-Z0-9_-]{1,100}$/.test(id)||!title.trim()||title.length>250||story.scenes.length>=100||story.scenes.some(s=>s.id===id))throw Error('Escribe una escena válida de hasta 250 caracteres.');
 return{...project,story:{...story,scenes:[...story.scenes,{id,sequenceId,title:title.trim(),setting:'',notes:''}]}};
}
export function assignStoryScene(project:Project,shotId:string,storySceneId?:string):Project{
 if(storySceneId&&!project.story?.scenes.some(s=>s.id===storySceneId))throw Error('La escena narrativa ya no existe.');
 return{...project,scenes:project.scenes.map(s=>s.id===shotId?{...s,storySceneId}:s)};
}
export function removeStoryGroup(project:Project,kind:'sequence'|'scene',id:string):Project{
 if(!project.story)return project;
 const removed=new Set(project.story.scenes.filter(s=>kind==='sequence'?s.sequenceId===id:s.id===id).map(s=>s.id));
 return{...project,story:{sequences:project.story.sequences.filter(s=>kind!=='sequence'||s.id!==id),scenes:project.story.scenes.filter(s=>!removed.has(s.id))},scenes:project.scenes.map(s=>s.storySceneId&&removed.has(s.storySceneId)?{...s,storySceneId:undefined}:s)};
}
/** Montage order is canonical. Blocks may be intercut; moving explicitly gathers
 * only the chosen block, preserving every attachment and all other relative order. */
export function moveStoryBlock(project:Project,kind:'sequence'|'scene',id:string,direction:-1|1):Project{
 const key=(shotId:string)=>{const{scene,sequence}=storyContext(project,shotId);return(kind==='scene'?scene:sequence)?.id};
 const keys=[...new Set(project.scenes.map(s=>key(s.id)).filter((x):x is string=>!!x))],index=keys.indexOf(id),target=keys[index+direction];if(index<0||!target)return project;
 const moving=project.scenes.filter(s=>key(s.id)===id),remaining=project.scenes.filter(s=>key(s.id)!==id),targetIndexes=remaining.flatMap((s,i)=>key(s.id)===target?[i]:[]);
 if(!moving.length||!targetIndexes.length)return project;
 const at=direction===-1?targetIndexes[0]!:targetIndexes.at(-1)!+1;return{...project,scenes:[...remaining.slice(0,at),...moving,...remaining.slice(at)]};
}
export function orderedStoryGroups<T extends StoryScene|StorySequence>(project:Project,groups:T[],kind:'sequence'|'scene'):T[]{
 const first=(id:string)=>{const i=project.scenes.findIndex(s=>{const c=storyContext(project,s.id);return(kind==='scene'?c.scene:c.sequence)?.id===id});return i<0?Infinity:i};
 return[...groups].sort((a,b)=>first(a.id)-first(b.id));
}
/** Excludes the server save timestamp, never a security signature. */
export const storyVersion=(project:Project)=>JSON.stringify({...project,updatedAt:undefined},(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
