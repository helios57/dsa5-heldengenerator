import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { SOURCE_PDF, APP_DIR } from '../../tools/paths.ts';

test('source PDF is present and is a PDF', async () => {
  const head = (await readFile(SOURCE_PDF)).subarray(0, 8);
  expect(new TextDecoder().decode(head)).toBe('%PDF-1.7');
});

test('paths module exports absolute paths', () => {
  expect(APP_DIR.startsWith('/')).toBe(true);
});
