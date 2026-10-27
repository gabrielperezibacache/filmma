import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import sharp from 'sharp';
import { createApp } from '../server/app.ts';
import { createFilmmaTools, readLocalImage, validateFilmmaURL } from './filmma-mcp.mjs';

function rpcClient(url) {
  const child = spawn(process.execPath, [resolve('scripts/filmma-mcp.mjs')], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, FILMMA_URL: url } });
  let sequence = 0, pendingText = '', diagnostic = '';
  const pending = new Map();
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (data) => {
    pendingText += data; let newline;
    while ((newline = pendingText.indexOf('\n')) >= 0) {
      const message = JSON.parse(pendingText.slice(0, newline)); pendingText = pendingText.slice(newline + 1);
      const resolve = pending.get(message.id); if (resolve) { pending.delete(message.id); resolve(message); }
    }
  });
  child.stderr.on('data', (data) => { diagnostic += data; });
  return {
    async request(method, params = {}) {
      const id = ++sequence;
      const result = new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`MCP timeout: ${method}. ${diagnostic}`)); }, 10000);
        pending.set(id, (data) => { clearTimeout(timer); resolve(data); });
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      return result;
    },
    notify(method, params) { child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`); },
    async close() {
      const exited = once(child, 'exit'); child.stdin.end();
      const timer = setTimeout(() => child.kill('SIGKILL'), 1500);
      await exited; clearTimeout(timer);
    },
  };
}

test('MCP real: handshake, project, exact image import and non-destructive proposal', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'filmma-mcp-'));
  const app = await createApp({ dataDirectory: join(directory, 'data'), skipDiagnostics: true });
  const server = app.app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`, client = rpcClient(url);
  try {
    const early = await client.request('tools/list'); assert.equal(early.error.code, -32000);
    const init = await client.request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'filmma-test', version: '1' } });
    assert.equal(init.result.protocolVersion, '2025-11-25');
    client.notify('notifications/initialized');
    const list = await client.request('tools/list'); assert.equal(list.result.tools.length, 4);
    assert.equal(list.result.tools.find((tool) => tool.name === 'filmma_import_image').annotations.readOnlyHint, false);
    const read = await client.request('tools/call', { name: 'filmma_read_project', arguments: {} });
    const before = read.result.structuredContent.project;
    const imagePath = join(directory, 'generated.png');
    const original = await sharp({ create: { width: 32, height: 24, channels: 3, background: '#785d40' } }).png().toBuffer();
    await writeFile(imagePath, original);
    const imported = await client.request('tools/call', { name: 'filmma_import_image', arguments: { path: imagePath, name: 'Personaje nuevo' } });
    assert.equal(imported.result.isError, undefined);
    const asset = imported.result.structuredContent.asset;
    assert.equal(asset.mime, 'image/png');
    assert.deepEqual(await readFile(join(directory, 'data/media', basename(asset.url))), original);
    const elements = await client.request('tools/call', { name: 'filmma_list_elements', arguments: { kind: 'image', query: 'nuevo' } });
    assert.deepEqual(elements.result.structuredContent.assets.map((item) => item.id), [asset.id]);
    const proposal = await client.request('tools/call', { name: 'filmma_propose_scene', arguments: { title: 'La llegada', prompt: 'Slow dolly into a station.', imageAssetId: asset.id } });
    assert.equal(proposal.result.structuredContent.saved, false);
    assert.equal(proposal.result.structuredContent.scene.assetId, asset.id);
    const after = (await (await fetch(`${url}/api/bootstrap`)).json()).project;
    assert.deepEqual(after.scenes, before.scenes);
    assert.equal(after.assets.length, before.assets.length + 1);
    const invalidReference = await client.request('tools/call', { name: 'filmma_propose_scene', arguments: { title: 'X', prompt: 'X', imageAssetId: 'missing' } });
    assert.equal(invalidReference.result.isError, true);
    const unknown = await client.request('tools/call', { name: 'unsafe_tool', arguments: {} });
    assert.equal(unknown.error.code, -32602);
  } finally {
    await client.close(); await app.close();
    server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

test('image imports reject URLs, symlinks, fake MIME and extension mismatch', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'filmma-mcp-image-'));
  try {
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: 'black' } }).png().toBuffer();
    const image = join(directory, 'valid.png'); await writeFile(image, png);
    const link = join(directory, 'link.png'); await symlink(image, link);
    const wrong = join(directory, 'wrong.jpg'); await writeFile(wrong, png);
    const fake = join(directory, 'fake.png'); await writeFile(fake, '<svg><script>not an image</script></svg>');
    await assert.rejects(readLocalImage('https://example.com/image.png'), /ruta absoluta/);
    await assert.rejects(readLocalImage(link), /simbólicos/);
    await assert.rejects(readLocalImage(wrong), /extensión/);
    await assert.rejects(readLocalImage(fake), /firma de imagen/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('MCP API target is constrained to literal loopback HTTP origins', () => {
  assert.equal(validateFilmmaURL('http://localhost:4318'), 'http://127.0.0.1:4318');
  assert.equal(validateFilmmaURL('http://[::1]:4318'), 'http://[::1]:4318');
  for (const url of ['https://127.0.0.1:4318', 'http://example.com:4318', 'http://127.0.0.1:4318/api', 'http://user:password@127.0.0.1:4318', 'http://127.0.0.1:4318?x=y', 'http://127.0.0.1:4318/#x', 'http://127.0.0.1:80']) assert.throws(() => validateFilmmaURL(url));
});

test('MCP does not follow redirects, even to another local destination', async () => {
  let followed = false;
  const server = createServer((req, res) => {
    if (req.url === '/followed') { followed = true; res.end('{}'); return; }
    res.writeHead(302, { Location: '/followed' }); res.end();
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const tools = createFilmmaTools(`http://127.0.0.1:${server.address().port}`);
    await assert.rejects(tools.call('filmma_read_project', {}));
    assert.equal(followed, false);
  } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
});
