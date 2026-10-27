import { spawn } from 'node:child_process';

export type ProcessOptions = { cwd?: string; signal?: AbortSignal; timeoutMs?: number; terminationGraceMs?: number; stdin?: string; onLine?: (line: string) => void; env?: NodeJS.ProcessEnv };
export function runProcess(command: string, args: string[], options: ProcessOptions = {}): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) return reject(new Error('Trabajo cancelado.'));
    const child = spawn(command, args, { cwd: options.cwd, env: options.env ?? process.env, shell: false, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    let stdout = '', stderr = '', pendingLine = '', failure: Error | undefined, settled = false;
    let forceTimer: NodeJS.Timeout | undefined;
    const terminate = () => {
      if (!child.pid) return;
      try { process.platform === 'win32' ? child.kill('SIGTERM') : process.kill(-child.pid, 'SIGTERM'); } catch {}
      if (!forceTimer) forceTimer = setTimeout(() => { try { process.platform === 'win32' ? child.kill('SIGKILL') : process.kill(-child.pid!, 'SIGKILL'); } catch {} }, options.terminationGraceMs ?? 2500);
      forceTimer.unref();
    };
    const abort = () => { failure = new Error('Trabajo cancelado.'); terminate(); };
    options.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => { failure = new Error('El proceso superó el tiempo máximo.'); terminate(); }, options.timeoutMs ?? 30000);
    timer.unref();
    const finish = (error?: Error, code = 0) => {
      if (settled) return; settled = true;
      clearTimeout(timer); if (forceTimer) clearTimeout(forceTimer); options.signal?.removeEventListener('abort', abort);
      if (pendingLine) options.onLine?.(pendingLine);
      if (error || failure) reject(error ?? failure); else resolve({ stdout, stderr, code });
    };
    child.on('error', (error) => finish(error));
    child.stdout.on('data', (chunk: Buffer) => {
      const value = chunk.toString(); stdout = (stdout + value).slice(-2_000_000);
      pendingLine += value;
      let index: number;
      while ((index = pendingLine.indexOf('\n')) !== -1) {
        options.onLine?.(pendingLine.slice(0, index)); pendingLine = pendingLine.slice(index + 1);
      }
      if (pendingLine.length > 500000) pendingLine = pendingLine.slice(-500000);
    });
    child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-50000); });
    child.stdin.on('error', () => {});
    child.stdin.end(options.stdin ?? '');
    child.on('close', (code) => finish(undefined, code ?? -1));
  });
}

export function parseJsonOutput(stdout: string): any {
  try { return JSON.parse(stdout); } catch {}
  for (const line of stdout.trim().split('\n').reverse()) {
    try { return JSON.parse(line); } catch {}
  }
  throw new Error('El proceso local no devolvió un resultado JSON válido.');
}
