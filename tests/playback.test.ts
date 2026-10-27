import test from 'node:test';
import assert from 'node:assert/strict';
import {syncMediaClock} from '../src/playback';

function media(duration=3){
  const element={duration,readyState:1,currentTime:0,volume:1,muted:false,paused:true,pause(){element.paused=true},play(){element.paused=false;return Promise.resolve()}};
  return element as unknown as HTMLMediaElement;
}
test('montage seek updates paused audio and video on the same source clock',()=>{
  const element=media();syncMediaClock(element,{time:1.5,playing:false,volume:.35,fps:24});
  assert.equal(element.currentTime,1.5);assert.equal(element.volume,.35);assert.equal(element.paused,true);
  syncMediaClock(element,{time:1.5,playing:true,volume:0,fps:24});
  assert.equal(element.paused,false);assert.equal(element.muted,true);
});
test('short sources hold their last frame silently and resume after a seek back',()=>{
  const element=media();syncMediaClock(element,{time:5,playing:true,volume:.8,fps:24});
  assert.equal(element.currentTime,2.999);assert.equal(element.paused,true);assert.equal(element.muted,true);
  syncMediaClock(element,{time:1,playing:true,volume:.8,fps:24});
  assert.equal(element.currentTime,1);assert.equal(element.paused,false);assert.equal(element.muted,false);
});
test('playing clock only corrects material drift, paused seeks remain frame precise',()=>{
  const element=media();element.currentTime=1;
  syncMediaClock(element,{time:1.03,playing:true,volume:1,fps:24});assert.equal(element.currentTime,1);
  syncMediaClock(element,{time:1.3,playing:true,volume:1,fps:24});assert.equal(element.currentTime,1.3);
  syncMediaClock(element,{time:1.25,playing:false,volume:1,fps:24});assert.equal(element.currentTime,1.25);
});
