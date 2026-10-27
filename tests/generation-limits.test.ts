import test from 'node:test';
import assert from 'node:assert/strict';
import { H3_NATIVE_MAX_VIDEO_TOKENS as SERVER_MAX_VIDEO_TOKENS, h3VisualTokens, generationFrames, generationTimeoutMs, validateGenerationMemoryProfile } from '../server/generation-limits.js';
import { H3_NATIVE_MAX_FRAMES, H3_NATIVE_MAX_VIDEO_TOKENS, h3NativeVideoTokens, generationPreview } from '../src/generation-profile.js';

const longTake = { memoryProfile: 'h3-long-ssd', model: 'minimax-h3' as const, width: 512, height: 320, numFrames: generationFrames(15, 'minimax-h3'), steps: 20, conditioningMode: 'text' };

test('explicit long profile keeps native continuous H3 timing and bounded geometry', () => {
  assert.equal(validateGenerationMemoryProfile(longTake), 'h3-long-ssd');
  assert.equal(longTake.numFrames, 345);
  assert.equal(longTake.numFrames / 24, 14.375);
  assert.equal(validateGenerationMemoryProfile({ ...longTake, width: 320, height: 512 }), 'h3-long-ssd');
  for (const invalid of [{ memoryProfile: 'unknown' }, { model: 'ltx-2b' as const }, { width: 544 }, { height: 352 }, { numFrames: 346 }, { numFrames: 362 }, { steps: 1 }, { steps: 21 }, { conditioningMode: 'image' }, { hasImageReferences: true }]) {
    assert.throws(() => validateGenerationMemoryProfile({ ...longTake, ...invalid }), { status: 400 });
  }
});

test('normal generation retains its profile and model-specific step requirements', () => {
  assert.equal(validateGenerationMemoryProfile({ ...longTake, memoryProfile: undefined, width: 768, height: 448, conditioningMode: 'image' }), 'conservative');
  assert.equal(validateGenerationMemoryProfile({ ...longTake, memoryProfile: 'conservative', model: 'ltx-2b', steps: 1 }), 'conservative');
  assert.throws(() => validateGenerationMemoryProfile({ ...longTake, memoryProfile: 'conservative', steps: 1 }), /al menos 2 pasos/);
});


test('native-resolution profile bounds geometry and visual tokens before worker launch', () => {
  const pilot = { ...longTake, memoryProfile: 'h3-native-ssd', width: 1024, height: 576, numFrames: 22 };
  for (const dimensions of [{ width: 1024, height: 576 }, { width: 576, height: 1024 }, { width: 768, height: 768 }]) {
    assert.equal(validateGenerationMemoryProfile({ ...pilot, ...dimensions }), 'h3-native-ssd');
  }
  for (const invalid of [{ numFrames: 23 }, { numFrames: 345 }, { numFrames: 5 }, { width: 1312 }, { width: 1280, height: 768 }, { width: 1000 }, { width: 224 }, { steps: 1 }, { steps: 21 }, { conditioningMode: 'image' }, { hasImageReferences: true }, { model: 'ltx-2b' as const }]) {
    assert.throws(() => validateGenerationMemoryProfile({ ...pilot, ...invalid }), { status: 400 });
  }
});


test('native UI formats and budget decisions match the server without shortening requests', () => {
  assert.equal(H3_NATIVE_MAX_FRAMES, 345);
  assert.equal(H3_NATIVE_MAX_VIDEO_TOKENS, SERVER_MAX_VIDEO_TOKENS);
  assert.equal(H3_NATIVE_MAX_VIDEO_TOKENS, 35000);
  for (const format of ['16:9', '9:16', '1:1', '4:3', '4:5', '2.39:1']) {
    const preview = generationPreview('minimax-h3', 1, 15, format, 'quality', 20, 'detail');
    assert.equal(preview.blockedReason, undefined);
    assert.equal(validateGenerationMemoryProfile({ ...preview, model: 'minimax-h3', conditioningMode: 'text' }), 'h3-native-ssd');
    const long = generationPreview('minimax-h3', 15, 15, format, 'quality', 20, 'detail');
    assert.ok(long.blockedReason); assert.equal(long.numFrames, 345, 'UI must not silently shorten a take');
    assert.throws(() => validateGenerationMemoryProfile({ ...long, model: 'minimax-h3', conditioningMode: 'text' }), { status: 400 });
    const balanced = generationPreview('minimax-h3', 15, 15, format, 'quality', 20, 'balanced');
    assert.equal(balanced.blockedReason, undefined); assert.equal(balanced.numFrames, 345);
    assert.equal(validateGenerationMemoryProfile({ ...balanced, model: 'minimax-h3', conditioningMode: 'text' }), 'h3-native-ssd');
    assert.equal(h3VisualTokens(balanced.width, balanced.height, balanced.numFrames), h3NativeVideoTokens(balanced.width, balanced.height, balanced.numFrames));
  }
});


test('native budget accepts14.375s at768 and8s at1024, but refuses the next aligned1024 frame group', () => {
  const native = { ...longTake, memoryProfile: 'h3-native-ssd' };
  for (const [width, height, numFrames, expectedTokens] of [[768,448,345,34272],[448,768,345,34272],[1024,576,192,32832],[576,1024,192,32832],[1024,576,90,15552]] as const) {
    assert.equal(validateGenerationMemoryProfile({ ...native, width, height, numFrames }), 'h3-native-ssd');
    assert.equal(h3VisualTokens(width!, height!, numFrames!), expectedTokens);
  }
  assert.equal(h3VisualTokens(1024,576,209),35712);
  for (const numFrames of [209,345]) assert.throws(() => validateGenerationMemoryProfile({ ...native, width:1024, height:576, numFrames }), {status:400});
});


test('720p-class native geometry preserves736rows and stays inside the visual-token budget', () => {
  const native={...longTake,memoryProfile:'h3-native-ssd',width:1280,height:736};
  for(const numFrames of [22,124]) assert.equal(validateGenerationMemoryProfile({...native,numFrames}),'h3-native-ssd');
  assert.equal(validateGenerationMemoryProfile({...native,width:736,height:1280,numFrames:124}),'h3-native-ssd');
  assert.equal(h3VisualTokens(1280,736,22),6440); assert.equal(h3VisualTokens(1280,736,124),34040);
  assert.equal(h3VisualTokens(1280,736,141),38640); assert.equal(h3VisualTokens(1280,736,345),93840);
  for(const patch of [{numFrames:141},{numFrames:345},{numFrames:22,height:720},{numFrames:22,width:1312},{numFrames:22,height:768}]) {
    assert.throws(()=>validateGenerationMemoryProfile({...native,...patch}),{status:400});
  }
});


test('HD long profile alone admits345frames at full720p-class geometry and has cleanup time', () => {
  const hd={...longTake,memoryProfile:'h3-hd-ssd',width:1280,height:736};
  for(const dimensions of [{width:1280,height:736},{width:736,height:1280}]) {
    assert.equal(validateGenerationMemoryProfile({...hd,...dimensions}),'h3-hd-ssd');
    const preview=generationPreview('minimax-h3',15,15,dimensions.width===1280?'16:9':'9:16','quality',20,'hd720');
    assert.equal(preview.memoryProfile,'h3-hd-ssd'); assert.equal(preview.blockedReason,undefined);
    assert.equal(validateGenerationMemoryProfile({...preview,model:'minimax-h3',conditioningMode:'text'}),'h3-hd-ssd');
  }
  for(const patch of [{memoryProfile:'h3-native-ssd'},{width:1024,height:576},{width:960,height:960},{height:720},{numFrames:346},{steps:21},{conditioningMode:'image'},{hasImageReferences:true},{model:'ltx-2b' as const}]) {
    assert.throws(()=>validateGenerationMemoryProfile({...hd,...patch}),{status:400});
  }
  assert.equal(generationTimeoutMs('h3-hd-ssd'),12*60*60*1000+30000);
  for(const profile of [undefined,'conservative','h3-long-ssd','h3-native-ssd']) assert.equal(generationTimeoutMs(profile),6*60*60*1000);
});
