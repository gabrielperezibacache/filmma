import {useEffect} from 'react';

/** Wait for lazy workspaces before moving keyboard focus. No editor input is reset. */
export function useWorkspaceFocus(page:string){
 useEffect(()=>{
  window.scrollTo({top:0,behavior:'auto'});
  document.querySelector('main')?.scrollTo({top:0,behavior:'auto'});
  let observer:MutationObserver|undefined;
  const focus=()=>{
   const heading=document.querySelector<HTMLElement>('main h1');if(!heading)return;
   observer?.disconnect();
   if(document.querySelector('[role="dialog"]')||document.activeElement?.matches('input,textarea,select'))return;
   heading.tabIndex=-1;heading.focus({preventScroll:true});
  };
  observer=new MutationObserver(focus);observer.observe(document.body,{childList:true,subtree:true});focus();
  return()=>observer?.disconnect();
 },[page]);
}
