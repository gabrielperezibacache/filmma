import {createContext,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {DEFAULT_APP_PREFERENCES,type AppPreferences} from './app-preferences';
import {api} from './api';
import {setLanguage} from './i18n';
type State={preferences:AppPreferences;ready:boolean;save:(patch:Partial<AppPreferences>)=>Promise<void>};
const Context=createContext<State>({preferences:DEFAULT_APP_PREFERENCES,ready:false,save:async()=>{}});
export const usePreferences=()=>useContext(Context);
export function PreferencesProvider({children}:{children:ReactNode}){
 const[preferences,setPreferences]=useState(DEFAULT_APP_PREFERENCES),[ready,setReady]=useState(false);
 const queue=useRef(Promise.resolve());
 useEffect(()=>{let live=true;api('/application/preferences').then(d=>{if(live){setLanguage(d.preferences.language);setPreferences(d.preferences)}}).finally(()=>{if(live)setReady(true)}).catch(()=>{});return()=>{live=false}},[]);
 useEffect(()=>{const el=document.documentElement;for(const key of ['theme','accent','scale','density','navigation','motion'] as const)el.dataset[key]=preferences[key];el.lang=preferences.language;setLanguage(preferences.language);localStorage.setItem('filmma-interface',JSON.stringify(preferences));},[preferences]);
 const save=(patch:Partial<AppPreferences>)=>{const work=queue.current.catch(()=>{}).then(async()=>{const d=await api('/application/preferences',patch,'PUT');setLanguage(d.preferences.language);setPreferences(d.preferences)});queue.current=work;return work};
 return <Context.Provider value={{preferences,ready,save}}>{children}</Context.Provider>;
}
