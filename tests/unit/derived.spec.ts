import { test, expect } from '@playwright/test';
import {
  EIGENSCHAFTEN, SCHICKSALSPUNKTE_START, basiswerte,
  lebensenergie, seelenkraft, zaehigkeit, ausweichen, initiative, geschwindigkeit,
  astralenergie, karmaenergie,
} from '../../src/core/derived.ts';
import type { Eigenschaften, Grundwerte } from '../../src/core/types.ts';

const E: Eigenschaften = { MU: 12, KL: 13, IN: 11, CH: 10, FF: 12, GE: 13, KO: 14, KK: 12 };
const G: Grundwerte = { le: 5, sk: -5, zk: -5, gs: 8 };

test('the eight attributes in sheet order', () => {
  expect(EIGENSCHAFTEN).toEqual(['MU', 'KL', 'IN', 'CH', 'FF', 'GE', 'KO', 'KK']);
});

test('Lebensenergie is base plus twice Konstitution', () => {
  expect(lebensenergie(G, E)).toBe(33);
  expect(lebensenergie(G, E, 3)).toBe(36);
});

test('Seelenkraft and Zähigkeit round to nearest', () => {
  expect(seelenkraft(G, E)).toBe(1);   // -5 + 36/6 = 1
  expect(zaehigkeit(G, E)).toBe(2);    // -5 + 40/6 = 1.67 -> round 7 - 5 = 2
});

test('Ausweichen and Initiative', () => {
  expect(ausweichen(E)).toBe(7);       // 13/2 = 6.5 -> 7
  expect(initiative(E)).toBe(13);      // 25/2 = 12.5 -> 13
});

test('Geschwindigkeit comes straight from the species base', () => {
  expect(geschwindigkeit(G)).toBe(8);
  expect(geschwindigkeit(G, -1)).toBe(7);
});

test('Astral- and Karmaenergie are base 20 plus the tradition lead attribute', () => {
  expect(astralenergie({ leitwert: 13 })).toBe(33);
  expect(karmaenergie({ leitwert: 12, mod: 2 })).toBe(34);
  expect(astralenergie({ leitwert: 13, grundwert: 20, mod: -3 })).toBe(30);
});

test('basiswerte assembles the whole set', () => {
  expect(basiswerte(G, E)).toEqual({ LE: 33, SK: 1, ZK: 2, AW: 7, INI: 13, GS: 8 });
});

test('every hero starts with three Schicksalspunkte', () => {
  expect(SCHICKSALSPUNKTE_START).toBe(3);
});
