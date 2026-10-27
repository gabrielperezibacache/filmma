import type{Project,CharacterState,ContinuityValues}from'./types';
import{continuityFields,resolveContinuity,updateContinuity}from'./continuity';
export function saveCharacterState(project:Project,characterId:string,state:CharacterState):Project{
 const character=project.characters.find(c=>c.id===characterId);if(!character)throw Error('El elemento ya no existe.');
 if(!state.name.trim()||state.name.length>120)throw Error('Escribe un nombre de estado de hasta 120 caracteres.');
 if(!character.states?.some(s=>s.id===state.id)&&(character.states?.length??0)>=20)throw Error('Cada elemento admite hasta veinte estados.');
 const values=Object.fromEntries(continuityFields.map(k=>[k,state.values[k]??''])) as ContinuityValues;
 for(const k of continuityFields)if((values[k]?.length??0)>(k==='notes'?2000:1200))throw Error('El estado supera el límite de texto.');
 const next={...state,name:state.name.trim(),values};return{...project,characters:project.characters.map(c=>c.id===characterId?{...c,states:c.states?.some(s=>s.id===state.id)?c.states.map(s=>s.id===state.id?next:s):[...c.states??[],next]}:c)};
}
export function applyCharacterState(project:Project,shotId:string,characterId:string,stateId:string,reason:string):Project{
 const character=project.characters.find(c=>c.id===characterId),state=character?.states?.find(s=>s.id===stateId),appearance=resolveContinuity(project,shotId,characterId);
 if(!state||!appearance)throw Error('Vincula el elemento a este plano y elige un estado guardado.');
 if(!reason.trim()||reason.length>1200)throw Error('Explica brevemente el motivo narrativo del estado.');
 const values=Object.fromEntries(continuityFields.map(k=>[k,state.values[k]??'']));
 return updateContinuity(project,shotId,characterId,{...values,stateLabel:state.name,intentionalChange:true,changeReason:reason.trim()});
}
