import { getDocumentProxy, extractText } from 'unpdf';
import mammoth from 'mammoth';

export const libraryLimit = 20 * 1024 * 1024;

const supabaseOrigin = 'https://vdgmgkftqxwxfqmaylxx.supabase.co';

export function libraryConfig(request) {
  const token = request.headers['x-vercel-oidc-token'];
  if (process.env.VERCEL_ENV !== 'production' || typeof token !== 'string' || !token) return null;
  return { url: supabaseOrigin + '/functions/v1/dr-library', token, origin: supabaseOrigin };
}

export async function libraryCall(config, operation, payload = {}) {
  const response = await fetch(config.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.token },
    body: JSON.stringify({ operation, payload }),
    signal: AbortSignal.timeout(35_000)
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error || 'No se pudo contactar a la biblioteca.');
  return body;
}

export async function documentSections(name, contents) {
  if (/\.pdf$/i.test(name)) {
    const pdf = await getDocumentProxy(new Uint8Array(contents));
    try {
      const { text } = await extractText(pdf);
      const missing = text.flatMap((page, index) => page.trim() ? [] : [index + 1]);
      if (missing.length) {
        throw new Error('El PDF contiene páginas sin texto extraíble (' + missing.join(', ') + '). Sube una versión con OCR para indexar todo el documento.');
      }
      return text.map((page, index) => ({ label: 'Página ' + (index + 1), text: page }));
    } finally {
      await pdf.destroy();
    }
  }
  const text = /\.docx$/i.test(name)
    ? (await mammoth.extractRawText({ buffer: contents })).value
    : new TextDecoder().decode(contents);
  return [{ label: '', text }];
}

export function chunkDocument(sections) {
  const chunks = [];
  for (const section of sections) {
    const words = section.text.trim().split(/\s+/u).filter(Boolean);
    let start = 0;
    while (start < words.length) {
      const end = Math.min(start + 180, words.length);
      const text = words.slice(start, end).join(' ');
      chunks.push(section.label ? section.label + '\n' + text : text);
      if (end === words.length) break;
      start = end - 35;
    }
  }
  if (!chunks.length) throw new Error('El documento no contiene texto extraíble.');
  return chunks;
}

export function libraryDocument(doc) {
  return {
    id: doc.id,
    name: doc.filename,
    status: doc.status,
    validity: {
      state: doc.validity_state,
      version: doc.validity_version,
      from: doc.valid_from || '',
      until: doc.valid_until || ''
    }
  };
}
