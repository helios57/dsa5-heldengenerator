import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PDFDoc } from '../../src/io/pdf-document.ts';
import { readAcroFields, fieldValue, decodeText } from '../../src/io/pdf-acroform.ts';
import { isPdfString, isArray } from '../../src/io/pdf-lexer.ts';
import type { FieldInfo } from '../../src/io/pdf-acroform.ts';
import { SOURCE_PDF } from '../../tools/paths.ts';

let doc: PDFDoc;
let fields: Map<string, FieldInfo>;
test.beforeAll(async () => {
  doc = await PDFDoc.load(new Uint8Array(await readFile(SOURCE_PDF)));
  fields = await readAcroFields(doc);
});

test('finds every terminal field, and only terminal fields', () => {
  expect(fields.size).toBe(5442);
});

test('MU_1 carries six widgets, each with its own appearance', () => {
  const mu = fields.get('MU_1');
  expect(mu).toBeDefined();
  expect(mu!.type).toBe('Tx');
  expect(mu!.widgets.length).toBe(6);
  for (const w of mu!.widgets) expect(w.dict.has('AP')).toBe(true);
});

test('a field without kids is its own widget', () => {
  const held = fields.get('Held_Name');
  expect(held!.widgets.length).toBe(1);
  expect(held!.widgets[0]!.ref).toBe(held!.ref);
});

test('container nodes are excluded, their leaf fields are kept', () => {
  // AEAnzeige and AEAnzeige.RTF are grouping nodes with no /FT - not fillable.
  expect(fields.has('AEAnzeige')).toBe(false);
  expect(fields.has('AEAnzeige.RTF')).toBe(false);
  // The real fields are the leaves below them, reached through qualified names.
  expect(fields.has('AEAnzeige.FontSize')).toBe(true);
  expect(fields.has('AEAnzeige.RTF.FontSize')).toBe(true);
});

test('every terminal field carries its own /FT (no inheritance in this document)', () => {
  for (const field of fields.values()) expect(field.dict.has('FT'), field.name).toBe(true);
});

test('the walk descends through containers to build qualified names', () => {
  const dotted = [...fields.keys()].filter((n) => n.includes('.'));
  expect(dotted.length).toBe(422);
});

test('exposes the display attributes the writer needs', () => {
  const mu = fields.get('MU_1')!;
  const da = mu.dict.get('DA');
  expect(isPdfString(da) && decodeText(da.str)).toContain('Tf');
  expect(mu.dict.get('Q')).toBe(1);
  const rect = mu.widgets[0]!.dict.get('Rect');
  expect(isArray(rect) && rect.length).toBe(4);
});

test('reads values of the unfilled template as empty', async () => {
  expect(await fieldValue(doc, fields.get('Held_Name'))).toBe('');
});

test('decodeText handles UTF-16BE with BOM and latin1', () => {
  expect(decodeText(new Uint8Array([0xfe, 0xff, 0x00, 0x41, 0x00, 0x42]))).toBe('AB');
  expect(decodeText(new Uint8Array([0x41, 0x42]))).toBe('AB');
});
