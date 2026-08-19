import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PDFDoc } from '../../src/io/pdf-document.ts';
import { extractJavaScript } from '../../tools/pdf-js-extract.ts';
import { SOURCE_PDF } from '../../tools/paths.ts';

let scripts: Map<string, string>;
test.beforeAll(async () => {
  const doc = await PDFDoc.load(new Uint8Array(await readFile(SOURCE_PDF)));
  scripts = await extractJavaScript(doc);
});

test('extracts every document-level script', () => {
  expect(scripts.size).toBe(797);
});

test('includes the lookup functions the data build depends on', () => {
  for (const name of [
    'TalentGetInfo', 'SpeziesGetInfo', 'KulturGetInfo', 'ProfessionGetInfo',
    'VorteilGetInfo', 'NachteilGetInfo', 'ZauberGetInfo', 'LiturgieGetInfo',
    'KampftechnikGetInfo', 'ErfahrungsgradGetInfo',
    'EigenschaftAPRechner', 'TalentKosten', 'EnergieKosten', 'SpaltenFaktor',
  ]) {
    expect(scripts.has(name), `missing ${name}`).toBe(true);
  }
});

test('decodes umlauts correctly across all encodings', () => {
  expect(scripts.get('TalentGetInfo')).toContain('Körper');
  expect(scripts.get('TalentGetInfo')).toContain('Loyalität');
  expect(scripts.get('SpeziesGetInfo')).toContain('Größe');
  expect(scripts.get('ErfahrungsgradGetInfo')).toContain('Legendär');
});

test('no script contains the Unicode replacement character', () => {
  const broken = [...scripts].filter(([, src]) => src.includes('�')).map(([n]) => n);
  expect(broken).toEqual([]);
});
