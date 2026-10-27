import type {Project} from './types';
import {dialogueSnapshot} from './dialogue';

/** Bind a click to the interpretation the user saw, even during an asynchronous save. */
export async function saveDialogueRequest(getProject:()=>Project,lineId:string,save:()=>Promise<void>){
 const before=getProject(),line=before.dialogueLines?.find(l=>l.id===lineId);
 if(!line)throw new Error('La intervención ya no está disponible.');
 const projectId=before.id,expected=JSON.stringify(dialogueSnapshot(before,line));
 await save();
 const after=getProject(),current=after.dialogueLines?.find(l=>l.id===lineId);
 if(after.id!==projectId||!current||JSON.stringify(dialogueSnapshot(after,current))!==expected)
  throw new Error('El diálogo o su voz cambió mientras se guardaba. Revisa la selección y vuelve a pulsar Generar; no se envió ninguna solicitud de voz.');
}
