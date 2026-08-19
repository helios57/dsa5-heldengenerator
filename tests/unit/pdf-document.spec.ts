import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PDFDoc } from '../../src/io/pdf-document.ts';
import { isDict } from '../../src/io/pdf-lexer.ts';
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
