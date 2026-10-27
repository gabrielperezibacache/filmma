import assert from 'node:assert/strict';
import test from 'node:test';
import {exportDimensions,type ProjectFormat} from '../src/export-resolution.js';

test('720p export uses an HD canvas for every project proportion, separate from the aligned native source',()=>{
 const expected:Record<ProjectFormat,[number,number]>={
  '16:9':[1280,720],'9:16':[720,1280],'1:1':[720,720],
  '4:3':[960,720],'4:5':[720,900],'2.39:1':[1280,536],
 };
 for(const [format,dimensions] of Object.entries(expected)){
  assert.deepEqual(exportDimensions(format,'720p'),dimensions);
  for(const value of dimensions){assert.equal(value%2,0);assert(Number.isInteger(value))}
 }
 assert.deepEqual(exportDimensions('legacy','720p'),[1280,720]);
 assert.notDeepEqual(exportDimensions('16:9','720p'),[1280,736],'The deliverable canvas is distinct from MiniMax native alignment');
});

test('adding HD720 preserves the default Full HD and existing 4K canvases',()=>{
 for(const [format,full,uhd] of [
  ['16:9',[1920,1080],[3840,2160]],['9:16',[1080,1920],[2160,3840]],
  ['1:1',[1080,1080],[2160,2160]],['4:3',[1440,1080],[2880,2160]],
  ['4:5',[1080,1350],[2160,2700]],['2.39:1',[1920,804],[3840,1608]],
 ] as const){
  assert.deepEqual(exportDimensions(format),full);
  assert.deepEqual(exportDimensions(format,'1080p'),full);
  assert.deepEqual(exportDimensions(format,'2160p'),uhd);
 }
});
