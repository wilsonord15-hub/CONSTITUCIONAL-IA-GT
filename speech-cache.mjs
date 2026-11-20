import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile, unlink } from 'node:fs/promises';
import { get, put } from '@vercel/blob';

const directory = new URL('./.data/speech/', import.meta.url);
const cache = new Map();

async function readStored(filename, hosted) {
  if (!hosted) {
    try { return await readFile(new URL(filename, directory)); } catch { return undefined; }
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) return undefined;
  const result = await get('voz/' + filename, { access: 'private', abortSignal: AbortSignal.timeout(3500) });
  return result?.statusCode === 200 ? Buffer.from(await new Response(result.stream).arrayBuffer()) : undefined;
}

async function storeClip(filename, audio, hosted) {
  if (hosted) {
    if (!process.env.BLOB_READ_WRITE_TOKEN) return false;
    await put('voz/' + filename, audio, {
      access: 'private',
      contentType: 'application/octet-stream',
      addRandomSuffix: false,
      allowOverwrite: true,
      abortSignal: AbortSignal.timeout(6000)
    });
    return true;
  }
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = new URL(randomUUID(), directory);
  try {
    await writeFile(temporary, audio, { mode: 0o600 });
    await rename(temporary, new URL(filename, directory));
    return true;
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

export async function reusableGreeting(options, hosted, generate) {
  const key = createHash('sha256').update(JSON.stringify(options)).digest('hex');
  const filename = 'saludo-' + key + '.bin';
  // Only the fixed greeting's voice/accent combinations can enter this cache.
  const cacheKey = (hosted ? 'hosted:' : 'local:') + filename;
  let pending = cache.get(cacheKey);
  if (!pending) {
    pending = (async () => {
      const saved = await readStored(filename, hosted).catch(() => undefined);
      if (saved?.length) return { bytes: saved, storage: 'persistent' };
      const bytes = await generate();
      const durable = await storeClip(filename, bytes, hosted).catch(() => false);
      return { bytes, storage: durable ? 'persistent' : 'memory' };
    })();
    cache.set(cacheKey, pending);
  }
  try {
    return await pending;
  } catch (error) {
    if (cache.get(cacheKey) === pending) cache.delete(cacheKey);
    throw error;
  }
}
