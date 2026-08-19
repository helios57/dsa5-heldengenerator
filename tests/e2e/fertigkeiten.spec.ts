import { test, expect } from '@playwright/test';

test('Erhöhen einer Fertigkeit zeigt die korrekten AP-Kosten', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('schritt-fertigkeiten').click();

  await expect(page.getByTestId('fertigkeit-Tal1-wert')).toHaveValue('0');
  const plus = page.getByTestId('fertigkeit-Tal1-plus');
  for (let i = 0; i < 3; i += 1) await plus.click();

  await expect(page.getByTestId('fertigkeit-Tal1-wert')).toHaveValue('3');
  // Fliegen (Tal1): SF B (Faktor 2), keine Aktivierung -> 3 * 2 = 6 AP.
  await expect(page.getByTestId('fertigkeit-Tal1-kosten')).toHaveText('6 AP');
  await expect(page.getByTestId('ap-ausgegeben')).toHaveText('6');
});

test('Kampftechniken starten bei 6, nicht bei 0', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('schritt-fertigkeiten').click();
  await expect(page.getByTestId('kampftechnik-Armbrüste-wert')).toHaveValue('6');
});

test('Ein durch die Eigenschaft gedeckelter Wert nennt die Eigenschaft in der Marginale', async ({ page }) => {
  await page.goto('/');
  // Meisterlich: Fertigkeits-Deckel 16 — weit über dem Eigenschafts-Deckel bei Standardwerten
  // (MU 8 + 2 = 10). Der Eigenschafts-Deckel bindet also zuerst.
  await page.locator('#grad-EG4').check();

  await page.getByTestId('schritt-fertigkeiten').click();
  const plus = page.getByTestId('fertigkeit-Tal1-plus');
  for (let i = 0; i < 10; i += 1) await plus.click();

  await expect(page.getByTestId('fertigkeit-Tal1-wert')).toHaveValue('10');
  const marginale = page.getByTestId('fertigkeit-Tal1-zeile').locator('.marginale');
  await expect(marginale).toBeVisible();
  await expect(marginale).toContainText('MU');
  await expect(marginale).toContainText('8');
  await expect(marginale).toContainText('10');
  await expect(marginale).not.toContainText('Meisterlich');
});

test('Ein durch den Erfahrungsgrad gedeckelter Wert nennt den Erfahrungsgrad in der Marginale', async ({ page }) => {
  await page.goto('/');
  // Unerfahren: Fertigkeits-Deckel 10. MU wird auf den Erfahrungsgrad-Höchstwert (12) gehoben,
  // sodass der Eigenschafts-Deckel (12+2=14) über dem Erfahrungsgrad-Deckel (10) liegt — der
  // Erfahrungsgrad bindet zuerst.
  await page.locator('#grad-EG0').check();

  await page.getByTestId('schritt-eigenschaften').click();
  const eigenschaftPlus = page.getByTestId('eigenschaft-MU-plus');
  for (let i = 0; i < 4; i += 1) await eigenschaftPlus.click();
  await expect(page.getByTestId('eigenschaft-MU-gekauft')).toHaveValue('12');

  await page.getByTestId('schritt-fertigkeiten').click();
  const plus = page.getByTestId('fertigkeit-Tal1-plus');
  for (let i = 0; i < 10; i += 1) await plus.click();

  await expect(page.getByTestId('fertigkeit-Tal1-wert')).toHaveValue('10');
  const marginale = page.getByTestId('fertigkeit-Tal1-zeile').locator('.marginale');
  await expect(marginale).toBeVisible();
  await expect(marginale).toContainText('Unerfahren');
  await expect(marginale).toContainText('10');
  await expect(marginale).not.toContainText('MU');
});
