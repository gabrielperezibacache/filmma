import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runProcess } from '../server/process.js';

test('timeout lets an owning worker stop and reap its separate engine group before it exits', { timeout: 15000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'filmma-timeout-cleanup-'));
  const worker = join(directory, 'worker.cjs'), marker = join(directory, 'reaped.txt');
  let enginePid: number | undefined;
  // Both processes only wait. This exercises the process-group topology of
  // the runtime/H3 pair without loading models or accessing the GPU.
  await writeFile(worker, `
    const {spawn}=require('node:child_process'),fs=require('node:fs');
    const engine=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});console.log('ready');setInterval(()=>{},1000)"],{detached:true,stdio:['ignore','pipe','ignore']});
    engine.stdout.once('data',()=>console.log('engine:'+engine.pid));
    let stopping=false;
    process.on('SIGTERM',()=>{
      if(stopping)return;stopping=true;
      process.kill(-engine.pid,'SIGTERM');
      setTimeout(()=>{try{process.kill(-engine.pid,'SIGKILL')}catch{}},3100);
    });
    engine.once('exit',()=>{fs.writeFileSync(process.argv[2],'engine reaped');process.exit(0)});
  `);
  try {
    await assert.rejects(runProcess(process.execPath, [worker, marker], {
      timeoutMs: 1000,
      terminationGraceMs: 5000,
      onLine(line) { if (line.startsWith('engine:')) enginePid = Number(line.slice(7)); },
    }), /tiempo máximo/);
    assert.ok(enginePid, 'worker reported its own child before the timeout');
    assert.equal(await readFile(marker, 'utf8'), 'engine reaped');
    assert.throws(() => process.kill(-enginePid!, 0), { code: 'ESRCH' }, 'no separate engine group remains');
  } finally {
    if (enginePid) { try { process.kill(-enginePid, 'SIGKILL'); } catch {} }
    await rm(directory, { recursive: true, force: true });
  }
});
