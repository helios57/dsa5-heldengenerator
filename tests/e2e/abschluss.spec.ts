import { test, expect } from '@playwright/test';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const APP_DIR = fileURLToPath(new URL('../../app/', import.meta.url));
const PDF_VORLAGE = join(
  APP_DIR,
  '423187-Charakterbogen_V2_13_(ausfuellbar_selbstrechnend_ohne_Hintergrund)_korr_V2.pdf',
);

/**
 * Ein vollständiger, nach allen drei in Schritt XII geprüften Regeln legaler Held (Ruling R13,
 * §5.5 AP-Konto): Erfahrungsgrad Unerfahren (Budget 900), Spezies Mensch (S16, 0 AP), Kultur
 * Andergast (K2, 20 AP), Eigenschaft MU 11 (Kosten 45 AP: `(11-8)*15`), Talent Tal1 auf FW 39
 * (Kosten 834 AP: Spalte B, `(11 + (39-11)*(39-10)/2) * 2`). Ausgegeben gesamt 899 -> Rest 1 AP
 * — innerhalb [0, MAX_REST_AP]. Nachgerechnet in einem Node-Snippet gegen dieselben Formeln aus
 * costs.ts, nicht geschätzt. `held.sonderfertigkeiten`/`ausruestung` bleiben leer — Schritt XII
 * prüft sie nicht (kein Kohärenz-Grund ohne Tradition/Energien-Kauf).
 */
const LEGALER_HELD = {
  schemaVersion: 1,
  meta: {
    name: 'Legal Testheld', familie: '', geburtsort: '', geburtsdatum: '', alter: '',
    geschlecht: '', groesse: '', gewicht: '', haarfarbe: '', augenfarbe: '', titel: '',
    sozialstatus: '', charakteristika: '', sonstiges: '',
  },
  erfahrungsgrad: 'EG0',
  spezies: 'S16',
  speziesAbzug: null,
  kultur: 'K2',
  profession: null,
  eigenschaftenGekauft: { MU: 11, KL: 8, IN: 8, CH: 8, FF: 8, GE: 8, KO: 8, KK: 8 },
  fertigkeiten: { Tal1: 39 },
  kampftechniken: {},
  vorteile: [],
  nachteile: [],
  sonderfertigkeiten: [],
  zauber: {},
  liturgien: {},
  traditionMagisch: null,
  traditionKarmal: null,
  energienKauf: { le: 0, ae: 0, ke: 0 },
  ausruestung: [],
  geld: { dukaten: 0, silbertaler: 0, heller: 0, kreuzer: 0 },
  notizen: '',
};

test('Prüfbericht meldet ein Problem für einen frischen (unvollständigen) Helden', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('schritt-abschluss').click();

  await expect(page.getByTestId('pruefbericht-leer')).toHaveCount(0);
  await expect(page.getByTestId('befund')).toHaveCount(1);
  await expect(page.getByTestId('befund').first()).toContainText('AP');
});

test('mehr als 10 ungenutzte AP werden in der AP-Bilanz gemeldet (Rest nicht negativ)', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('schritt-abschluss').click();

  // Frischer EG2-Held (Budget 1100), noch nichts gekauft: Rest 1100, weit über MAX_REST_AP (10).
  const restZeile = page.getByTestId('ap-bilanz-rest');
  await expect(restZeile).toHaveClass(/ap-bilanz__zeile--verletzung/);
  await expect(restZeile).toContainText('1100');
  await expect(restZeile).toContainText('10');

  const negativZeile = page.getByTestId('ap-bilanz-negativ');
  await expect(negativZeile).not.toHaveClass(/ap-bilanz__zeile--verletzung/);
});

test('Prüfbericht ist leer für einen vollständigen, legalen Helden (per JSON-Import)', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('schritt-abschluss').click();

  await page.getByTestId('import-json-datei').setInputFiles({
    name: 'legal.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(LEGALER_HELD), 'utf-8'),
  });

  await expect(page.getByTestId('import-json-status')).toHaveText('JSON importiert.');
  await expect(page.getByTestId('pruefbericht-leer')).toBeVisible();
  await expect(page.getByTestId('befund')).toHaveCount(0);
  await expect(page.getByTestId('ap-bilanz-rest')).not.toHaveClass(/ap-bilanz__zeile--verletzung/);
  await expect(page.getByTestId('ap-bilanz-negativ')).not.toHaveClass(/ap-bilanz__zeile--verletzung/);
});

test('JSON-Rundreise über die Oberfläche: Export, Reimport derselben Datei, Held unverändert', async ({ page }) => {
  await page.goto('/');

  const konzeptText = 'Rundreise-Test-Konzept-42';
  await page.getByTestId('konzept-text').fill(konzeptText);
  await page.getByTestId('konzept-text').blur();

  await page.getByTestId('schritt-eigenschaften').click();
  const plus = page.getByTestId('eigenschaft-MU-plus');
  for (let i = 0; i < 4; i += 1) await plus.click();
  await expect(page.getByTestId('eigenschaft-MU-gekauft')).toHaveValue('12');

  await page.getByTestId('schritt-abschluss').click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('export-json').click();
  const download = await downloadPromise;
  const pfad = await download.path();
  expect(pfad).not.toBeNull();
  const exportierterText = await readFile(pfad as string, 'utf-8');

  const exportiert: unknown = JSON.parse(exportierterText);
  expect((exportiert as { schemaVersion: number }).schemaVersion).toBe(1);
  expect((exportiert as { notizen: string }).notizen).toBe(konzeptText);
  expect((exportiert as { eigenschaftenGekauft: { MU: number } }).eigenschaftenGekauft.MU).toBe(12);

  // Neu laden auf einen leeren Helden (Autosave löschen), damit der Reimport beobachtbar
  // etwas verändert statt nur denselben Zustand erneut zu schreiben.
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId('konzept-text')).toHaveValue('');

  await page.getByTestId('schritt-abschluss').click();
  await page.getByTestId('import-json-datei').setInputFiles({
    name: 'export.json',
    mimeType: 'application/json',
    buffer: Buffer.from(exportierterText, 'utf-8'),
  });
  await expect(page.getByTestId('import-json-status')).toHaveText('JSON importiert.');

  await page.getByTestId('schritt-konzept').click();
  await expect(page.getByTestId('konzept-text')).toHaveValue(konzeptText);

  await page.getByTestId('schritt-eigenschaften').click();
  await expect(page.getByTestId('eigenschaft-MU-gekauft')).toHaveValue('12');
});

test('PDF-Export läuft im Browser: Ergebnis beginnt mit %PDF und ist größer als die Vorlage', async ({ page }) => {
  const vorlageInfo = await stat(PDF_VORLAGE);

  await page.goto('/');
  await page.getByTestId('schritt-abschluss').click();

  const downloadPromise = page.waitForEvent('download', { timeout: 30_000 });
  await page.getByTestId('export-pdf').click();
  const download = await downloadPromise;
  const pfad = await download.path();
  expect(pfad).not.toBeNull();

  const bytes = await readFile(pfad as string);
  expect(bytes.subarray(0, 4).toString('latin1')).toBe('%PDF');
  expect(bytes.length).toBeGreaterThan(vorlageInfo.size);

  await expect(page.getByTestId('export-pdf-status')).toHaveText('PDF heruntergeladen.');
});

test('Druckstile blenden Leiste, AP-Band und Bedienelemente aus (Print-Media-Emulation)', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('schritt-abschluss').click();

  await page.emulateMedia({ media: 'print' });

  const raster = await page.locator('#step-rail').evaluate((el) => getComputedStyle(el).display);
  expect(raster).toBe('none');

  const apBand = await page.locator('#ap-band').evaluate((el) => getComputedStyle(el).display);
  expect(apBand).toBe('none');

  const basiswerte = await page.locator('#basiswerte-panel').evaluate((el) => getComputedStyle(el).display);
  expect(basiswerte).toBe('none');

  const exportKnopf = await page.getByTestId('export-json').evaluate((el) => getComputedStyle(el).display);
  expect(exportKnopf).toBe('none');

  const spielbogen = await page.locator('.spielbogen-druck').evaluate((el) => getComputedStyle(el).display);
  expect(spielbogen).toBe('block');
});
