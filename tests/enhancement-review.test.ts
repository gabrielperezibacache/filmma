import assert from 'node:assert/strict';
import test from 'node:test';
import {reviewCanvas,reviewDimensions,reviewSourceDimensions} from '../src/enhancement-review.js';
import type {Asset} from '../src/types.js';

test('100% review keeps the output pixel size on desktop and mobile instead of enlarging the fitted preview',()=>{
 const output={width:3642,height:2276};
 for(const viewport of [{width:900,height:500},{width:328,height:205}]){
  assert.deepEqual(reviewCanvas(output,viewport,'100'),output);
  assert.deepEqual(reviewCanvas(output,viewport,'200'),{width:7284,height:4552});
  assert.deepEqual(reviewCanvas(output,viewport,'fit'),viewport);
 }
});

test('imported sources use measured video dimensions and never infer 4K source detail from the copy',()=>{
 const imported:Asset={id:'original',name:'Original',type:'video',mime:'video/mp4',url:'/original.mp4',size:1};
 assert.equal(reviewSourceDimensions(imported,null),null);
 assert.deepEqual(reviewSourceDimensions(imported,{width:512,height:320}),{width:512,height:320});
 const version:Asset={...imported,id:'copy',enhancement:{sourceAssetId:'original',preset:'ai-4k',method:'realesrgan-ncnn',width:3642,height:2276,duration:14.375,fps:24,createdAt:'2026-10-18'}};
 assert.deepEqual(reviewSourceDimensions(version,null),{width:3642,height:2276});
 assert.deepEqual(reviewSourceDimensions(version,{width:3840,height:2160}),{width:3840,height:2160},'Loaded file metadata takes precedence over stale provenance');
 assert.equal(reviewSourceDimensions(imported,null),null,'Inspecting a copy does not mutate or relabel its source');
});

test('unavailable media dimensions remain unknown and cannot produce an invalid zoom canvas',()=>{
 for(const [width,height] of [[undefined,undefined],[0,320],[512,0],[NaN,320],[512,Infinity],[-1,320]])assert.equal(reviewDimensions(width,height),null);
 assert.deepEqual(reviewDimensions(512,320),{width:512,height:320});
 const viewport={width:900,height:500};
 assert.deepEqual(reviewCanvas(null,viewport,'100'),viewport);
});
