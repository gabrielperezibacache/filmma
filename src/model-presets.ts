export const MODEL_PRESETS = {
 'ltx-preview':{id:'ltx-preview',model:'ltx-2b',name:'Vista previa',width:512,height:288,frames:25,fps:24,steps:4,seconds:25/24,memoryProfile:'conservative',minimumMemoryGB:24},
 'ltx-balanced':{id:'ltx-balanced',model:'ltx-2b',name:'Equilibrado',width:768,height:448,frames:25,fps:24,steps:4,seconds:25/24,memoryProfile:'conservative',minimumMemoryGB:32},
 'h3-safe':{id:'h3-safe',model:'minimax-h3',name:'MiniMax · prueba breve',width:512,height:320,frames:22,fps:24,steps:20,seconds:22/24,memoryProfile:'conservative',minimumMemoryGB:32},
 'h3-detail':{id:'h3-detail',model:'minimax-h3',name:'MiniMax · detalle nativo',width:1024,height:576,frames:22,fps:24,steps:20,seconds:22/24,memoryProfile:'h3-native-ssd',minimumMemoryGB:32},
 'h3-hd':{id:'h3-hd',model:'minimax-h3',name:'MiniMax · detalle HD breve',width:1280,height:736,frames:22,fps:24,steps:20,seconds:22/24,memoryProfile:'h3-native-ssd',minimumMemoryGB:32},
} as const;
export type ModelPresetId=keyof typeof MODEL_PRESETS;
export type ModelPreset=typeof MODEL_PRESETS[ModelPresetId];
export const presetControls=(p:ModelPreset)=>({model:p.model,duration:Math.max(1,p.seconds),quality:p.id==='h3-safe'?'conservative':p.id==='ltx-balanced'?'quality':'draft',nativeResolution:p.id==='h3-hd'?'hd720' as const:p.id==='h3-detail'?'detail' as const:'standard' as const,steps:p.steps});
