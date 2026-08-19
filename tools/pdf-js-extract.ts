import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { PDFDoc } from '../src/io/pdf-document.ts';
import { latin1, isArray, isPdfString, isStream, isRef } from '../src/io/pdf-lexer.ts';
import type { PdfObject, PdfValue } from '../src/io/pdf-lexer.ts';
import { SOURCE_PDF, JS_DIR } from './paths.ts';

export function decodeSource(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    /* not valid UTF-8 */
  }
  const cp1252 = new TextDecoder('windows-1252').decode(bytes);
  if (!cp1252.includes('�')) return cp1252;
  return latin1(bytes);
}

async function jsBytes(doc: PDFDoc, entry: PdfValue): Promise<Uint8Array | null> {
  if (isRef(entry)) return await jsBytes(doc, (await doc.get(entry.ref)) as PdfValue);
  if (isPdfString(entry)) return entry.str;
  if (isStream(entry)) return await doc.streamData(entry);
  return null;
}

async function collect(doc: PDFDoc, node: PdfObject | undefined, out: Map<string, string>): Promise<void> {
  const dict = await doc.resolveDict(node);
  if (!dict) return;

  const names = await doc.resolve(dict.get('Names'));
  if (isArray(names)) {
    for (let i = 0; i < names.length; i += 2) {
      const keyRaw = await doc.resolve(names[i] as PdfObject);
      const actionDict = await doc.resolveDict(names[i + 1] as PdfObject);
      if (!isPdfString(keyRaw) || !actionDict) continue;
      const jsEntry = actionDict.get('JS');
      if (jsEntry === undefined) continue;
      const bytes = await jsBytes(doc, jsEntry);
      if (!bytes) continue;
      out.set(decodeSource(keyRaw.str), decodeSource(bytes));
    }
  }

  const kids = await doc.resolve(dict.get('Kids'));
  if (isArray(kids)) for (const kid of kids) await collect(doc, kid as PdfObject, out);
}

export async function extractJavaScript(doc: PDFDoc): Promise<Map<string, string>> {
  const root = await doc.resolveDict(doc.trailer.get('Root'));
  if (!root) throw new Error('document has no catalog');
  const names = await doc.resolveDict(root.get('Names'));
  if (!names) throw new Error('document has no name tree');
  const tree = names.get('JavaScript');
  if (tree === undefined) throw new Error('document has no JavaScript name tree');
  const out = new Map<string, string>();
  await collect(doc, tree, out);
  return out;
}

async function main(): Promise<void> {
  const doc = await PDFDoc.load(new Uint8Array(await readFile(SOURCE_PDF)));
  const scripts = await extractJavaScript(doc);
  await rm(JS_DIR, { recursive: true, force: true });
  await mkdir(JS_DIR, { recursive: true });
  for (const [name, source] of scripts) {
    const safe = name.replace(/[^A-Za-z0-9._-]/g, '_');
    await writeFile(join(JS_DIR, `${safe}.js`), source, 'utf8');
  }
  console.log(`extracted ${scripts.size} scripts to ${JS_DIR}`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
