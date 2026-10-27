import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceTrim} from '../src/sourceTrim.js';
test('source trim uses frame boundaries at each project rate and excludes the out frame',()=>{for(const fps of [24,25,30])assert.deepEqual(sourceTrim(fps,3*fps,4,fps),{trimStart:1,duration:2})});
test('source trim rejects inverted, too short, out of source and too long ranges',()=>{for(const args of [[20,10,4,24],[0,23,4,24],[-1,48,4,24],[0,97,4,24],[0,2900,150,24],[0,.5,4,24],[0,24,NaN,24]])assert.throws(()=>sourceTrim(...args as [number,number,number,number]))});
