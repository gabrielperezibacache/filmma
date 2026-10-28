import test from'node:test';import assert from'node:assert/strict';import{mkdtemp,writeFile,mkdir,symlink,readFile,rm}from'node:fs/promises';import{join}from'node:path';import{tmpdir}from'node:os';import{NativeDownloadReceipt}from'../server/native-download';
test('download receipt rejects ambiguous names, old files, multiple candidates, symlinks and oversized files',async()=>{const dir=await mkdtemp(join(tmpdir(),'filmma-native-'));try{
 for(const prefix of ['../outside','video/../../','x','prefix.*'])assert.throws(()=>new NativeDownloadReceipt(dir,prefix));
 const folder=join(dir,'files');await mkdir(folder);await writeFile(join(folder,'Cinema_old.mp4'),'keep');const receipt=await new NativeDownloadReceipt(folder,'Cinema_').begin();assert.equal(await receipt.capture(join(dir,'copy.mp4')),null);
 await writeFile(join(folder,'Cinema_new.mp4'),'one');await writeFile(join(folder,'Cinema_second.mp4'),'two');await assert.rejects(receipt.capture(join(dir,'copy.mp4')),/varias/);
 const empty=join(dir,'links');await mkdir(empty);const link=await new NativeDownloadReceipt(empty,'Cinema_').begin();await symlink(join(folder,'Cinema_old.mp4'),join(empty,'Cinema_link.mp4'));await assert.rejects(link.capture(join(dir,'link-copy.mp4')),/regular/);
 const huge=join(dir,'huge');await mkdir(huge);const bounded=await new NativeDownloadReceipt(huge,'Cinema_',3).begin();await writeFile(join(huge,'Cinema_new.mp4'),'four');await assert.rejects(bounded.capture(join(dir,'huge-copy.mp4')),/límite/);
 assert.equal(await readFile(join(folder,'Cinema_old.mp4'),'utf8'),'keep');
}finally{await rm(dir,{recursive:true,force:true})}});
