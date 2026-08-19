import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PDFDoc } from '../../src/io/pdf-document.ts';
import { readAcroFields, fieldValue } from '../../src/io/pdf-acroform.ts';
import type { FieldInfo } from '../../src/io/pdf-acroform.ts';
import { schreibeFormular } from '../../src/io/pdf-writer.ts';
import { isRef, isStream, latin1 } from '../../src/io/pdf-lexer.ts';
import { SOURCE_PDF } from '../../tools/paths.ts';

const WERTE = new Map<string, string>([
  ['MU_1', '13'],
  ['Held_Name', 'Grimmbart Söhnlein'],
  ['Talent_FW_1', '7'],
  ['Held_Spezies_Anzeige', 'Zwerg'],
]);

let originalBytes: Uint8Array;
let originalSnapshot: Uint8Array;
let doc: PDFDoc;
let fields: Map<string, FieldInfo>;
let out: Uint8Array;

test.beforeAll(async () => {
  originalBytes = new Uint8Array(await readFile(SOURCE_PDF));
  originalSnapshot = originalBytes.slice();
  doc = await PDFDoc.load(originalBytes);
  fields = await readAcroFields(doc);
  out = await schreibeFormular(originalBytes, doc, fields, WERTE);
});

test('does not mutate the original byte buffer', () => {
  expect(originalBytes).toEqual(originalSnapshot);
});

test('output is an incremental update: original bytes verbatim, then more', () => {
  expect(out.length).toBeGreaterThan(originalBytes.length);
  expect(out.subarray(0, originalBytes.length)).toEqual(originalBytes);
});

test('round-trips every written value through a fresh parse, field count unchanged', async () => {
  const doc2 = await PDFDoc.load(out);
  const fields2 = await readAcroFields(doc2);
  expect(fields2.size).toBe(5442);
  for (const [name, value] of WERTE) {
    expect(await fieldValue(doc2, fields2.get(name))).toBe(value);
  }
});

test('all six MU_1 widgets get their own fresh appearance - none left stale', async () => {
  const doc2 = await PDFDoc.load(out);
  const fields2 = await readAcroFields(doc2);
  const mu = fields2.get('MU_1');
  expect(mu).toBeDefined();
  expect(mu!.widgets.length).toBe(6);

  const oldSize = doc.trailer.get('Size');
  expect(typeof oldSize).toBe('number');

  const apRefs = new Set<number>();
  for (const w of mu!.widgets) {
    const ap = await doc2.resolveDict(w.dict.get('AP'));
    expect(ap).not.toBeNull();
    const n = ap!.get('N');
    expect(isRef(n)).toBe(true);
    if (!isRef(n)) continue;
    // A stale widget would still point at an appearance object number below the original
    // document's object-number ceiling; every widget here must point at one we minted fresh.
    expect(n.ref).toBeGreaterThanOrEqual(oldSize as number);
    apRefs.add(n.ref);
    const resolved = await doc2.resolve(n);
    expect(isStream(resolved)).toBe(true);
  }
  // and each of the 6 widgets got its own distinct appearance object, not a shared one
  expect(apRefs.size).toBe(6);
});

test('/NeedAppearances is absent or false in the output', async () => {
  const doc2 = await PDFDoc.load(out);
  const root = await doc2.resolveDict(doc2.trailer.get('Root'));
  const acroForm = await doc2.resolveDict(root!.get('AcroForm'));
  const na = acroForm!.get('NeedAppearances');
  expect(na === undefined || na === false).toBe(true);
});

test('the generated appearance content for Held_Name is real: a Tj with the written text', async () => {
  const doc2 = await PDFDoc.load(out);
  const fields2 = await readAcroFields(doc2);
  const held = fields2.get('Held_Name');
  expect(held).toBeDefined();
  expect(held!.widgets.length).toBe(1);

  const ap = await doc2.resolveDict(held!.widgets[0]!.dict.get('AP'));
  const n = ap!.get('N');
  expect(isRef(n)).toBe(true);
  if (!isRef(n)) return;
  const stream = await doc2.resolve(n);
  expect(isStream(stream)).toBe(true);
  if (!isStream(stream)) return;

  const data = await doc2.streamData(stream);
  const text = latin1(data);
  expect(text).toContain('Tj');
  expect(text).toContain('Grimmbart Söhnlein');
});

test('auto-sized multiline fields stop at 12pt instead of filling their tall box', async () => {
  // Held_Vorteile is a 121.9pt-tall multiline field with `0 Tf` (auto-size). Sizing purely to
  // the box height would pick ~24pt and spill the text past the box; Acrobat caps auto-sized
  // multiline text at 12pt. Every multiline appearance Acrobat regenerated in the reference
  // sheet is exactly 12pt, so that is the number to match.
  const werte = new Map([['Held_Vorteile', 'Zauberer / Glück I / Eisern']]);
  const bytes = new Uint8Array(await readFile(SOURCE_PDF));
  const docML = await PDFDoc.load(bytes);
  const fieldsML = await readAcroFields(docML);
  const written = await schreibeFormular(bytes, docML, fieldsML, werte);

  const doc2 = await PDFDoc.load(written);
  const fields2 = await readAcroFields(doc2);
  const feld = fields2.get('Held_Vorteile');
  expect(feld).toBeDefined();

  const ap = await doc2.resolveDict(feld!.widgets[0]!.dict.get('AP'));
  const n = ap!.get('N');
  expect(isRef(n)).toBe(true);
  if (!isRef(n)) return;
  const stream = await doc2.resolve(n);
  expect(isStream(stream)).toBe(true);
  if (!isStream(stream)) return;

  const text = latin1(await doc2.streamData(stream));
  const tf = /\/\S+\s+([\d.]+)\s+Tf/.exec(text);
  expect(tf).not.toBeNull();
  expect(Number(tf![1])).toBeCloseTo(12, 5);
});
