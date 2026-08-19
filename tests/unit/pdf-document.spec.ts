import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PDFDoc } from '../../src/io/pdf-document.ts';
import { isDict, bytesFrom } from '../../src/io/pdf-lexer.ts';
import { SOURCE_PDF } from '../../tools/paths.ts';

let doc: PDFDoc;
test.beforeAll(async () => {
  doc = await PDFDoc.load(new Uint8Array(await readFile(SOURCE_PDF)));
});

test('indexes every object in the cross-reference streams', () => {
  expect(doc.index.size).toBe(17151);
});

test('reads the trailer and resolves the catalog', async () => {
  const root = await doc.resolveDict(doc.trailer.get('Root'));
  expect(root).not.toBeNull();
  expect(root!.get('Type')).toEqual({ name: 'Catalog' });
  expect([...root!.keys()].sort()).toEqual(
    ['AcroForm', 'Metadata', 'Names', 'OCProperties', 'Outlines', 'PageMode', 'Pages', 'Type'].sort(),
  );
});

test('resolves objects stored inside object streams', async () => {
  const compressed = [...doc.index.entries()].filter(([, e]) => e.type === 2);
  expect(compressed.length).toBeGreaterThan(1000);
  const first = compressed[0];
  expect(first).toBeDefined();
  expect(await doc.get(first![0])).not.toBeNull();
});

test('decodes streams through Flate and predictors', async () => {
  const root = await doc.resolveDict(doc.trailer.get('Root'));
  const names = await doc.resolveDict(root!.get('Names'));
  expect(names!.has('JavaScript')).toBe(true);
});

test('document has 10 pages', async () => {
  const root = await doc.resolveDict(doc.trailer.get('Root'));
  const pages = await doc.resolveDict(root!.get('Pages'));
  expect(pages!.get('Count')).toBe(10);
});

test('startxrefOffsets finds the trailing pointer', () => {
  const offsets = doc.startxrefOffsets();
  expect(offsets.length).toBeGreaterThan(0);
  expect(offsets.at(-1)).toBeGreaterThan(0);
});

test('resolveDict returns null for non-dictionaries', async () => {
  expect(await doc.resolveDict(42)).toBeNull();
  expect(isDict(await doc.resolveDict(doc.trailer.get('Root')))).toBe(true);
});

// --- Regression tests for review findings -------------------------------

test('loadObjStm throws a domain error on a self-referential /Length instead of overflowing the stack', async () => {
  const prefix = '%PDF-1.7\n';
  const objStmText =
    '10 0 obj\n<< /Type /ObjStm /N 1 /First 4 /Length 11 0 R >>\nstream\n11 0 X\nendstream\nendobj\n';
  const objStmOffset = prefix.length;
  const beforeXref = prefix + objStmText;
  const xrefOffset = beforeXref.length;
  const xrefText =
    'xref\n0 1\n0000000000 65535 f \ntrailer\n<< /Size 1 >>\nstartxref\n' + xrefOffset + '\n%%EOF';
  const bytes = bytesFrom(beforeXref + xrefText);

  // Object stream 10's own /Length is an indirect reference to object 11, and object 11
  // is (maliciously) indexed as living inside object stream 10 itself.
  const malformed = await PDFDoc.load(bytes);
  malformed.index.set(10, { type: 1, offset: objStmOffset });
  malformed.index.set(11, { type: 2, stm: 10, idx: 0 });

  let error: unknown;
  try {
    await malformed.get(11);
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(Error);
  expect(error).not.toBeInstanceOf(RangeError);
  expect((error as Error).message).toBe('object stream 10 is self-referential');
});

test('parseXrefChain guards a self-referential /XRefStm without overflowing the stack', async () => {
  // Classic xref table at offset 0 whose trailer points /XRefStm back at itself.
  const xrefText =
    'xref\n0 1\n0000000000 65535 f \ntrailer\n<< /Size 1 /XRefStm 0 >>\nstartxref\n0\n%%EOF';
  const bytes = bytesFrom(xrefText);

  let error: unknown;
  let loaded: PDFDoc | undefined;
  try {
    loaded = await PDFDoc.load(bytes);
  } catch (e) {
    error = e;
  }
  expect(error).toBeUndefined();
  expect(error).not.toBeInstanceOf(RangeError);
  expect(loaded).toBeDefined();
  expect(loaded!.trailer.get('XRefStm')).toBe(0);
});

test('loadObjStm rejects an /N that cannot fit the stream data instead of spinning', async () => {
  const prefix = '%PDF-1.7\n';
  const objStmText =
    '5 0 obj\n<< /Type /ObjStm /N 999999999 /First 4 /Length 2 >>\nstream\nAB\nendstream\nendobj\n';
  const objStmOffset = prefix.length;
  const beforeXref = prefix + objStmText;
  const xrefOffset = beforeXref.length;
  const xrefText =
    'xref\n0 1\n0000000000 65535 f \ntrailer\n<< /Size 1 >>\nstartxref\n' + xrefOffset + '\n%%EOF';
  const bytes = bytesFrom(beforeXref + xrefText);

  const malformed = await PDFDoc.load(bytes);
  malformed.index.set(5, { type: 1, offset: objStmOffset });
  malformed.index.set(6, { type: 2, stm: 5, idx: 0 });

  let error: unknown;
  try {
    await malformed.get(6);
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(Error);
  expect(error).not.toBeInstanceOf(RangeError);
  expect((error as Error).message).toBe('object stream /N exceeds stream data size');
});

test('load rejects an encrypted document instead of silently returning garbled strings', async () => {
  // Nothing in this module decrypts RC4/AES-obfuscated strings and streams; an unflagged
  // encrypted PDF would otherwise "load" successfully and just produce garbage. Plan 3
  // parses user-supplied PDFs, so this must fail loudly at load time instead.
  const xrefText =
    'xref\n0 1\n0000000000 65535 f \ntrailer\n<< /Size 1 /Encrypt 5 0 R >>\nstartxref\n0\n%%EOF';
  const bytes = bytesFrom(xrefText);

  let error: unknown;
  try {
    await PDFDoc.load(bytes);
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toMatch(/encrypt/i);
});
