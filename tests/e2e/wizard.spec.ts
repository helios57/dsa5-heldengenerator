import { test, expect } from '@playwright/test';

test('Kanzlei-Hülle rendert; alle vier Schritte sind über die Leiste erreichbar', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('h1')).toHaveText('DSA5 Heldengenerator');
  await expect(page.locator('#status')).toHaveText('bereit');

  await expect(page.getByTestId('schritt-konzept')).toBeVisible();
  await expect(page.getByTestId('konzept-text')).toBeVisible();

  await page.getByTestId('schritt-spezies').click();
  await expect(page.getByTestId('spezies-suche')).toBeVisible();

  await page.getByTestId('schritt-kultur').click();
  await expect(page.locator('.abschnitt-titel')).toHaveText('Kultur');

  await page.getByTestId('schritt-eigenschaften').click();
  await expect(page.getByTestId('eigenschaft-MU-gekauft')).toBeVisible();

  await page.getByTestId('schritt-konzept').click();
  await expect(page.getByTestId('konzept-text')).toBeVisible();
});

test('Unerfahren setzt das AP-Budget auf 900 und den Eigenschafts-Deckel auf 12', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('ap-budget')).toHaveText('1100');

  await page.locator('#grad-EG0').check();

  await expect(page.getByTestId('ap-budget')).toHaveText('900');
  await expect(page.getByTestId('grad-EG0-max-eigenschaft')).toHaveText('12');
});

test('MU von 8 auf 12 zeigt die korrekten AP-Kosten und aktualisiert das AP-Band', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('schritt-eigenschaften').click();

  await expect(page.getByTestId('eigenschaft-MU-gekauft')).toHaveValue('8');
  await expect(page.getByTestId('ap-ausgegeben')).toHaveText('0');

  const plus = page.getByTestId('eigenschaft-MU-plus');
  for (let i = 0; i < 4; i += 1) await plus.click();

  await expect(page.getByTestId('eigenschaft-MU-gekauft')).toHaveValue('12');
  // eigenschaftKosten(12) = (12-8)*15 = 60
  await expect(page.getByTestId('eigenschaft-MU-kosten')).toHaveText('60 AP');
  await expect(page.getByTestId('ap-ausgegeben')).toHaveText('60');
});

test('Auelfin-Fall: IN 14 gekauft ergibt final 15 mit sichtbarem +1, ohne gemeldeten Regelverstoß', async ({ page }) => {
  await page.goto('/');

  await page.getByTestId('schritt-spezies').click();
  await page.getByTestId('spezies-suche').fill('Auelf');
  await page.getByTestId('spezies-S2').click();
  await expect(page.getByTestId('spezies-S2')).toHaveAttribute('aria-pressed', 'true');

  await page.getByTestId('schritt-eigenschaften').click();
  const plus = page.getByTestId('eigenschaft-IN-plus');
  for (let i = 0; i < 6; i += 1) await plus.click(); // 8 -> 14, exakt am Erfahren-Deckel

  await expect(page.getByTestId('eigenschaft-IN-gekauft')).toHaveValue('14');
  await expect(page.getByTestId('eigenschaft-IN-final')).toHaveText('15');
  await expect(page.getByTestId('eigenschaft-IN-modifikator')).toHaveText('+1');

  // Ruling R13: gekauft (14, exakt am Deckel) validiert legal — final (15) wird nur ANGEZEIGT.
  await expect(page.locator('.marginale--verletzung')).toHaveCount(0);
});

test('Überschreiten der Punktsumme zeigt eine Marginale, die den Erfahrungsgrad benennt', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('schritt-eigenschaften').click();

  // Alle acht Eigenschaften auf ihren Erfahrungsgrad-Deckel (14) heben: jede einzelne bleibt
  // legal, aber die Summe (112) überschreitet den Erfahren-Punktedeckel von 100.
  for (const kurz of ['MU', 'KL', 'IN', 'CH', 'FF', 'GE', 'KO', 'KK']) {
    const feld = page.getByTestId(`eigenschaft-${kurz}-gekauft`);
    await feld.fill('14');
    await feld.dispatchEvent('change');
  }

  await expect(page.getByTestId('eigenschaften-summe')).toHaveText('112');

  const marginale = page.locator('.marginale--verletzung');
  await expect(marginale).toBeVisible();
  await expect(marginale).toContainText('Erfahren');
  await expect(marginale).toContainText('100');
});

test('Ein Neuladen stellt den begonnenen Helden aus dem Autosave wieder her', async ({ page }) => {
  await page.goto('/');

  const konzeptText = 'Ein Test-Konzept für die Wiederherstellung.';
  await page.getByTestId('konzept-text').fill(konzeptText);
  await page.getByTestId('konzept-text').blur();

  // Autosave verzögert 300ms (siehe state/store.ts) — mit Sicherheitsabstand abwarten.
  await page.waitForTimeout(600);
  await page.reload();

  await expect(page.getByTestId('konzept-text')).toHaveValue(konzeptText);
});
