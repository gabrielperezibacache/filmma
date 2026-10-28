import test from 'node:test';import assert from 'node:assert/strict';
import {localInstallationOptions} from '../src/local-installation';
import {installerPattern} from '../server/application';
test('36 GiB Apple hardware keeps SSD while ample RAM offers residency without declaring it measured',()=>{
 const small=localInstallationOptions({appleSilicon:true,memoryGB:36});assert.equal(small.weightResidency.effective,'ssd');assert.equal(small.weightResidency.ramEligible,false);assert.equal(small.options.find(o=>o.id==='metal-resident')?.eligible,false);
 const large=localInstallationOptions({appleSilicon:true,memoryGB:128});assert.equal(large.weightResidency.effective,'ram');assert.equal(large.options.find(o=>o.id==='metal-resident')?.recommended,true);
});
test('system RAM and discrete VRAM have separate gates; external engines never become integrated',()=>{
 const windows={platform:'Windows',memoryGB:128,gpus:[{vendor:'NVIDIA',name:'Test GPU',memoryGB:24}]};
 const option=localInstallationOptions(windows).options.find(o=>o.id==='cuda-int8-offload')!;assert.equal(option.eligible,true);assert.equal(option.integrated,false);
 for(const h of [{...windows,memoryGB:32},{...windows,gpus:[]},{...windows,gpus:[{vendor:'NVIDIA',name:'Test GPU',memoryGB:8}]}])assert.equal(localInstallationOptions(h).options.find(o=>o.id==='cuda-int8-offload')?.eligible,false);
 assert(localInstallationOptions(windows).options.filter(o=>o.integrated).every(o=>!o.eligible));
});
test('updaters select only installers belonging to the running platform and architecture',()=>{
 assert(installerPattern('win32','x64')?.test('Filmma-0.15.26-win-x64-Setup.exe'));
 assert(!installerPattern('win32','x64')?.test('Filmma-0.15.26-arm64.dmg'));
 assert(!installerPattern('darwin','arm64')?.test('Filmma-0.15.26-win-x64-Setup.exe'));
 assert(installerPattern('darwin','arm64')?.test('Filmma-0.15.26-arm64.dmg'));
 assert.equal(installerPattern('win32','arm64'),null);assert.equal(installerPattern('linux','x64'),null);
});
