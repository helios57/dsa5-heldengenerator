import { test, expect } from '@playwright/test';

test('Suche schränkt die Professionsliste ein', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('schritt-profession').click();

  await expect(page.getByTestId('profession-anzahl')).toContainText('952 Professionen');

  await page.getByTestId('profession-suche').fill('Achazscham');

  await expect(page.getByTestId('profession-anzahl')).not.toContainText('952 von 952');
  await expect(page.getByTestId('profession-achazschaman-in')).toBeVisible();
});

test('Auswahl einer Profession wendet ihr Paket an und bewegt das AP-Band', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('ap-ausgegeben')).toHaveText('0');

  await page.getByTestId('schritt-profession').click();
  await page.getByTestId('profession-suche').fill('Achazscham');
  await page.getByTestId('profession-achazschaman-in').click();

  await expect(page.getByTestId('profession-achazschaman-in')).toHaveAttribute('aria-pressed', 'true');

  const ausgegeben = Number(await page.getByTestId('ap-ausgegeben').textContent());
  expect(ausgegeben).toBeGreaterThan(0);

  // Talent-Paket: "Körperbeherrschung" (Tal4) mit 4 aus dem Achazschaman-Paket.
  await page.getByTestId('schritt-fertigkeiten').click();
  await expect(page.getByTestId('fertigkeit-Tal4-wert')).toHaveValue('4');

  // Kampftechnik-Paket ist ein Zuschlag auf den Startwert 6: Hiebwaffen +5 -> 11.
  await expect(page.getByTestId('kampftechnik-Hiebwaffen-wert')).toHaveValue('11');
});
