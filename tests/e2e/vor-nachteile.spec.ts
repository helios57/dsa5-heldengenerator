import { test, expect } from '@playwright/test';

test('Überschreiten von 80 AP in Vorteilen zeigt eine Verletzungs-Marginale', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('schritt-vornachteile').click();

  await expect(page.locator('.marginale--verletzung')).toHaveCount(0);

  // "Einkommen VI" kostet allein schon 200 AP — deutlich über dem 80-AP-Deckel.
  await page.getByTestId('vornachteile-suche').fill('Einkommen VI');
  await page.getByTestId('vorteil-VT35').click();

  await expect(page.getByTestId('vornachteile-vorteil-summe')).toHaveText('200');
  const marginale = page.locator('.marginale--verletzung');
  await expect(marginale).toBeVisible();
  await expect(marginale).toContainText('80');
  await expect(marginale).toContainText('Vorteile');
});

test('Ein Nachteil erscheint als AP-Gewinn, nicht als negativer Kostenwert', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('schritt-vornachteile').click();

  // "Blind" ist mit BasisKosten -50 gespeichert; angezeigt werden muss ein Gewinn von +50 AP.
  await page.getByTestId('vornachteile-suche').fill('Blind');
  await expect(page.getByTestId('nachteil-NT13-kosten')).toHaveText('+50 AP');

  await page.getByTestId('nachteil-NT13').click();

  await expect(page.getByTestId('nachteil-NT13')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('nachteil-NT13-kosten')).toHaveText('+50 AP');
  await expect(page.getByTestId('vornachteile-nachteil-summe')).toHaveText('50');
  // Innerhalb des 80-AP-Deckels: keine Verletzung, nur der sichtbare Gewinn.
  await expect(page.locator('.marginale--verletzung')).toHaveCount(0);
});
