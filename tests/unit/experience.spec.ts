import { test, expect } from '@playwright/test';
import { ERFAHRUNGSGRADE, erfahrungsgrad } from '../../src/core/experience.ts';

test('has all seven Erfahrungsgrade in ascending order', () => {
  expect(ERFAHRUNGSGRADE.map((g) => g.name)).toEqual([
    'Unerfahren', 'Durchschnittlich', 'Erfahren', 'Kompetent', 'Meisterlich', 'Brillant', 'Legendär',
  ]);
});

test('matches the official table exactly', () => {
  const table: Array<[string, number, number, number, number, number, number, number]> = [
    ['Unerfahren', 900, 12, 10, 8, 95, 8, 0],
    ['Durchschnittlich', 1000, 13, 10, 10, 98, 10, 1],
    ['Erfahren', 1100, 14, 10, 12, 100, 12, 2],
    ['Kompetent', 1200, 15, 13, 14, 102, 14, 3],
    ['Meisterlich', 1400, 16, 16, 16, 105, 16, 4],
    ['Brillant', 1700, 17, 19, 18, 109, 18, 5],
    ['Legendär', 2100, 18, 20, 20, 114, 20, 6],
  ];
  for (const [name, ap, eig, fert, kt, punkte, zauber, fremd] of table) {
    const g = erfahrungsgrad(name);
    expect(g, name).toBeDefined();
    expect(
      [g!.ap, g!.maxEigenschaft, g!.maxFertigkeit, g!.maxKampftechnik,
       g!.maxEigenschaftspunkte, g!.zauberAnzahl, g!.fremdzauber],
      name,
    ).toEqual([ap, eig, fert, kt, punkte, zauber, fremd]);
  }
});

test('lookup works by id and is case-insensitive by name', () => {
  expect(erfahrungsgrad('erfahren')?.ap).toBe(1100);
  expect(erfahrungsgrad('EG3')?.name).toBe('Kompetent');
  expect(erfahrungsgrad('nonsense')).toBeUndefined();
});
