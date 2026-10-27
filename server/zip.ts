import { createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { once } from 'node:events';

const table = new Uint32Array(256);
for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c; }
const crc = (buffer: Buffer, previous = 0xffffffff) => { let c = previous; for (const b of buffer) c = table[(c ^ b) & 255]! ^ (c >>> 8); return c; };

/** Streaming, uncompressed ZIP32: originals are copied byte-for-byte, never transcoded. */
export async function writeZip(destination: string, entries: { name: string; path?: string; data?: Buffer }[], signal?: AbortSignal) {
  if (entries.length > 65000) throw new Error('Demasiados archivos para el archivo ZIP.');
  const output = createWriteStream(destination, { mode: 0o600 });
  let outputError: Error | undefined;
  output.on('error', (error) => { outputError = error; });
  const write = async (data: Buffer) => {
    if (signal?.aborted) throw new Error('Trabajo cancelado.');
    if (outputError) throw outputError;
    if (!output.write(data)) await once(output, 'drain');
  };
  let offset = 0;
  const central: Buffer[] = [];
  try {
    for (const entry of entries) {
      if (!/^[a-zA-Z0-9_.\/-]+$/.test(entry.name) || entry.name.includes('..') || entry.name.startsWith('/')) throw new Error('Ruta ZIP inválida.');
      const size = entry.data?.length ?? (await stat(entry.path!)).size;
      if (size > 0xffffffff || offset + size > 0xffffffff) throw new Error('El archivo supera 4 GB. Conserva la carpeta data como respaldo completo.');
      let checksum = 0xffffffff;
      if (entry.data) checksum = crc(entry.data, checksum);
      else for await (const chunk of createReadStream(entry.path!)) { if (signal?.aborted) throw new Error('Trabajo cancelado.'); checksum = crc(chunk as Buffer, checksum); }
      checksum = (checksum ^ 0xffffffff) >>> 0;
      const name = Buffer.from(entry.name);
      const header = Buffer.alloc(30);
      header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt32LE(checksum, 14); header.writeUInt32LE(size, 18); header.writeUInt32LE(size, 22); header.writeUInt16LE(name.length, 26);
      await write(header); await write(name);
      if (entry.data) await write(entry.data); else for await (const chunk of createReadStream(entry.path!)) await write(chunk as Buffer);
      const directory = Buffer.alloc(46);
      directory.writeUInt32LE(0x02014b50, 0); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt32LE(checksum, 16); directory.writeUInt32LE(size, 20); directory.writeUInt32LE(size, 24); directory.writeUInt16LE(name.length, 28); directory.writeUInt32LE(offset, 42);
      central.push(directory, name); offset += 30 + name.length + size;
    }
    const directorySize = central.reduce((sum, item) => sum + item.length, 0);
    if (offset + directorySize > 0xffffffff) throw new Error('El archivo supera el límite ZIP de 4 GB.');
    for (const chunk of central) await write(chunk);
    const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directorySize, 12); end.writeUInt32LE(offset, 16);
    await write(end); output.end(); await once(output, 'finish');
  } catch (error) { output.destroy(); throw error; }
}
