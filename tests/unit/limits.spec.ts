import { test, expect } from '@playwright/test';
import {
  MAX_VORTEIL_AP, MAX_NACHTEIL_AP, MAX_REST_AP,
  EIGENSCHAFT_START, KAMPFTECHNIK_START, FERTIGKEIT_START,
  maxFertigkeit, maxKampftechnik, maxZauber,
  pruefeVorNachteile, pruefeEigenschaften, pruefeRestAP,
} from '../../src/core/limits.ts';
import type { Eigenschaften } from '../../src/core/types.ts';

const E: Eigenschaften = { MU: 12, KL: 13, IN: 11, CH: 10, FF: 12, GE: 13, KO: 14, KK: 12 };

test('constants match the official rules', () => {
  expect([MAX_VORTEIL_AP, MAX_NACHTEIL_AP, MAX_REST_AP]).toEqual([80, 80, 10]);
});

test('creation start values — Kampftechniken begin at 6, not 0', () => {
  expect(EIGENSCHAFT_START).toBe(8);
  expect(KAMPFTECHNIK_START).toBe(6);
  expect(FERTIGKEIT_START).toBe(0);
});

test('skill cap is the lower of attribute+2 and the Erfahrungsgrad cap', () => {
  expect(maxFertigkeit({ probe: ['KL', 'KL', 'IN'], eigenschaften: E, grad: 'Erfahren' }))
    .toEqual({ wert: 10, grund: 'erfahrungsgrad' });
  expect(maxFertigkeit({ probe: ['KL', 'KL', 'IN'], eigenschaften: E, grad: 'Legendär' }))
    .toEqual({ wert: 15, grund: 'eigenschaft' });
});

test('Herausragende Fertigkeit raises the attribute cap by one per rank', () => {
  expect(maxFertigkeit({ probe: ['KL'], eigenschaften: E, grad: 'Legendär', herausragend: 2 }))
    .toEqual({ wert: 17, grund: 'eigenschaft' });
});

test('combat technique cap uses the lead attribute plus two', () => {
  expect(maxKampftechnik({ leiteigenschaften: ['GE'], eigenschaften: E, grad: 'Legendär' }))
    .toEqual({ wert: 15, grund: 'eigenschaft' });
  expect(maxKampftechnik({ leiteigenschaften: ['GE'], eigenschaften: E, grad: 'Unerfahren' }))
    .toEqual({ wert: 8, grund: 'erfahrungsgrad' });
});

test('spells are additionally capped at 14 unless Merkmalskenntnis is present', () => {
  expect(maxZauber({ probe: ['KL', 'KL', 'KL'], eigenschaften: E, grad: 'Legendär' }))
    .toEqual({ wert: 14, grund: 'zauberobergrenze' });
  expect(maxZauber({ probe: ['KL', 'KL', 'KL'], eigenschaften: E, grad: 'Legendär', merkmalskenntnis: true }))
    .toEqual({ wert: 15, grund: 'eigenschaft' });
});

test('advantage and disadvantage AP limits', () => {
  expect(pruefeVorNachteile({ vorteilAP: 80, nachteilAP: 80 })).toEqual([]);
  const problems = pruefeVorNachteile({ vorteilAP: 95, nachteilAP: 81 });
  expect(problems.map((p) => p.code)).toEqual(['vorteil-ap', 'nachteil-ap']);
  expect(problems[0]).toMatchObject({ ist: 95, erlaubt: 80 });
});

test('attributes must stay within range and respect the point total', () => {
  const ok: Eigenschaften = { MU: 14, KL: 14, IN: 14, CH: 12, FF: 12, GE: 12, KO: 12, KK: 10 };
  expect(pruefeEigenschaften({ eigenschaften: ok, grad: 'Erfahren' })).toEqual([]);

  expect(pruefeEigenschaften({ eigenschaften: { ...ok, MU: 15 }, grad: 'Erfahren' })
    .map((p) => p.code)).toContain('eigenschaft-max');

  expect(pruefeEigenschaften({ eigenschaften: { ...ok, KK: 7 }, grad: 'Erfahren' })
    .map((p) => p.code)).toContain('eigenschaft-min');

  const tooMany: Eigenschaften = { MU: 14, KL: 14, IN: 14, CH: 13, FF: 13, GE: 13, KO: 13, KK: 13 };
  const problems = pruefeEigenschaften({ eigenschaften: tooMany, grad: 'Erfahren' });
  expect(problems.map((p) => p.code)).toContain('eigenschaftspunkte');
  expect(problems.find((p) => p.code === 'eigenschaftspunkte'))
    .toMatchObject({ ist: 107, erlaubt: 100 });
});

test('at most ten AP may be carried over, and never a negative balance', () => {
  expect(pruefeRestAP({ budget: 1100, ausgegeben: 1095 })).toEqual([]);
  expect(pruefeRestAP({ budget: 1100, ausgegeben: 1100 })).toEqual([]);
  expect(pruefeRestAP({ budget: 1100, ausgegeben: 1080 }).map((p) => p.code)).toEqual(['rest-ap']);
  expect(pruefeRestAP({ budget: 1100, ausgegeben: 1101 }).map((p) => p.code)).toEqual(['ap-ueberzogen']);
});

test('an unknown Erfahrungsgrad is rejected loudly', () => {
  expect(() => maxFertigkeit({ probe: ['KL'], eigenschaften: E, grad: 'Halbgott' })).toThrow();
});
