import { createApp } from './app.js';

const port = Number(process.env.FILMMA_PORT ?? 4318);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('FILMMA_PORT debe ser un puerto válido.');
const { app, close } = await createApp();
const server = app.listen(port, '127.0.0.1', () => console.log(`Filmma local: http://127.0.0.1:${port}`));
let stopping = false;
async function stop() {
  if (stopping) return; stopping = true;
  await close(); server.close();
  const force = setTimeout(() => process.exit(0), 3500); force.unref();
}
process.on('SIGTERM', () => void stop());
process.on('SIGINT', () => void stop());
