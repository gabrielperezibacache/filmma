import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createSeedProject } from './seed.js';
import { projectSchema, type Job, type Project } from './types.js';

export class Store {
  project: Project = createSeedProject();
  jobs: Job[] = [];
  private pending: Promise<void> = Promise.resolve();
  constructor(readonly directory: string) {}

  async init() {
    await Promise.all(['media', 'exports', 'work', 'projects'].map((dir) => mkdir(join(this.directory, dir), { recursive: true, mode: 0o700 })));
    try { this.project = projectSchema.parse(JSON.parse(await readFile(join(this.directory, 'project.json'), 'utf8'))); }
    catch (error: any) { if (error.code !== 'ENOENT') throw new Error(`No se pudo leer el proyecto guardado. El archivo se conserva: ${error.message}`); }
    // The first demo reused its exterior for every shot. Upgrade only those exact
    // bundled references; preserve the user's scenes, writing and imported files.
    if (this.project.id === 'filmma-first-film') {
      for (const n of [2, 3, 4]) {
        const asset = this.project.assets.find((item) => item.id === `demo-0${n}`);
        if (asset?.url === '/demo/scene-01.png') asset.url = `/demo/scene-0${n}.png`;
      }
    }
    try {
      const loaded = JSON.parse(await readFile(join(this.directory, 'jobs.json'), 'utf8'));
      if (!Array.isArray(loaded)) throw new Error('jobs.json no contiene una lista');
      this.jobs = loaded.slice(-300);
    } catch (error: any) { if (error.code !== 'ENOENT') throw error; }
    for (const job of this.jobs) {
      if (job.status === 'queued' || job.status === 'running') {
        job.status = 'failed'; job.message = 'El proceso se interrumpió al cerrar Filmma. Puedes volver a intentarlo.'; job.updatedAt = new Date().toISOString();
      }
    }
    await this.save();
  }

  save() {
    // Snapshot before queueing: each rename replaces one complete JSON document.
    const project = JSON.stringify(this.project, null, 2);
    const jobs = JSON.stringify(this.jobs.slice(-300), null, 2);
    const write = async (name: string, value: string) => {
      const temporary = join(this.directory, `${name}.${randomUUID()}.tmp`);
      await writeFile(temporary, value, { mode: 0o600 });
      await rename(temporary, join(this.directory, name));
    };
    this.pending = this.pending.catch(() => {}).then(async () => {
      await write('project.json', project);
      await write('jobs.json', jobs);
    });
    return this.pending;
  }
}
