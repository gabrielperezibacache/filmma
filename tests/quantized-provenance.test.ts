import assert from 'node:assert/strict';
import test from 'node:test';
import {generationProvenanceSchema} from '../server/types.js';
import {assetOrigin} from '../src/library.js';
import type {Asset} from '../src/types.js';

test('quantized provenance survives validation and stays linked to scene, character and original reference',()=>{
 const input={projectId:'qa-film',sceneId:'scene-01',model:'minimax-h3',modelVariant:'gguf-q4',modelRevision:'babc040eff0084465460ead58fdb8ec44296f8dd',runtimeRevision:'754858b4f28acd537d16a6ad97c5ee0f0635e950',seed:43,prompt:'Elena observes the screen.',negativePrompt:'',createdAt:'2026-10-29T00:00:00Z',width:512,height:320,numFrames:22,fps:24,steps:20,conditioningMode:'image',referenceAssetIds:['elena-original'],characterIds:['elena'],continuity:{elena:{costume:'Abrigo camel',appearance:'Cabello oscuro ondulado'}}};
 const generation=generationProvenanceSchema.parse(JSON.parse(JSON.stringify(input)));
 assert.deepEqual(generation,input);
 const asset:Asset={id:'new-take',name:'Elena Q4',type:'video',url:'/api/media/new.mp4',mime:'video/mp4',size:1024,generation};
 const origin=assetOrigin(asset);
 assert.match(origin.model!,/GGUF-Q4/);
 assert.deepEqual(origin.sources,['elena-original']);
 assert.equal(input.referenceAssetIds[0],'elena-original');
 assert.equal(generationProvenanceSchema.safeParse({...input,modelVariant:'unverified-backend'}).success,false);
});
