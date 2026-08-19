import { test, expect } from '@playwright/test';
import {
  leererHeld, speziesModifikatoren, eigenschaftenFinal, kampftechnikWert, fertigkeitWert,
} from '../../src/core/character.ts';
import { pruefeEigenschaften } from '../../src/core/limits.ts';
import { erfahrungsgrad } from '../../src/core/experience.ts';
import { EIGENSCHAFTEN } from '../../src/core/derived.ts';

test('leererHeld() is a valid empty hero at Erfahren (EG2)', () => {
  const held = leererHeld();
  expect(held.erfahrungsgrad).toBe('EG2');
  expect(erfahrungsgrad(held.erfahrungsgrad)?.name).toBe('Erfahren');
  for (const name of EIGENSCHAFTEN) expect(held.eigenschaftenGekauft[name]).toBe(8);
  expect(pruefeEigenschaften({ eigenschaften: held.eigenschaftenGekauft, grad: held.erfahrungsgrad }))
    .toEqual([]);
  // Absent combat techniques/skills read as their creation start values, not 0/undefined.
  expect(kampftechnikWert(held, 'Dolche')).toBe(6);
  expect(fertigkeitWert(held, 'Tal1')).toBe(0);
});

test('leererHeld(grad) honours an explicit Erfahrungsgrad', () => {
  const held = leererHeld('EG0');
  expect(held.erfahrungsgrad).toBe('EG0');
  expect(erfahrungsgrad(held.erfahrungsgrad)?.name).toBe('Unerfahren');
});

// --- the trap: purchased values are what gets validated, final values are what gets shown ---
//
// Real Auelfin sheet on Erfahren (cap 14): IN shows 15 because Elfen grant IN +1 (EW
// Eig3 +1, see app/data/spezies.json S2 "Elfen (Auelfen)"). She purchased IN 14 — exactly
// at the cap — so she is fully legal. A caller that validates the FINAL value (15) instead
// of the PURCHASED one (14) would wrongly reject her. This is Ruling R13 from limits.ts.

test('Auelfin trap: purchased IN 14 (at the Erfahren cap) plus Elfen +1 IN yields a legal final IN 15 that would fail if ever validated directly', () => {
  const held = leererHeld('EG2');
  held.eigenschaftenGekauft = { ...held.eigenschaftenGekauft, IN: 14 };
  held.speziesAbzug = 'KL'; // resolves the Elfen choice between KL-2 and KK-2; irrelevant to IN

  // Real Auelfen EW from app/data/spezies.json (S2): IN +1, GE +1, choice of KL-2 or KK-2.
  const auelfenEW = [['Eig3', 1], ['Eig6', 1], [['Eig2', -2], ['Eig8', -2]]];

  const final = eigenschaftenFinal(held, auelfenEW);
  expect(final.IN).toBe(15);

  // Validating PURCHASED values: legal, no problems.
  const aufGekauftenWerten = pruefeEigenschaften(
    { eigenschaften: held.eigenschaftenGekauft, grad: held.erfahrungsgrad },
  );
  expect(aufGekauftenWerten).toEqual([]);

  // Validating FINAL values instead (the bug this test guards against): reports a false
  // eigenschaft-max violation on IN, even though the character is perfectly legal.
  const aufFinalenWerten = pruefeEigenschaften({ eigenschaften: final, grad: held.erfahrungsgrad });
  expect(aufFinalenWerten).toContainEqual(
    expect.objectContaining({ code: 'eigenschaft-max', feld: 'IN', ist: 15, erlaubt: 14 }),
  );
});

test('a nested EW choice group contributes nothing until speziesAbzug resolves it', () => {
  const auelfenEW = [['Eig3', 1], ['Eig6', 1], [['Eig2', -2], ['Eig8', -2]]];
  expect(speziesModifikatoren(auelfenEW, null)).toEqual({ IN: 1, GE: 1 });
  expect(speziesModifikatoren(auelfenEW, 'KL')).toEqual({ IN: 1, GE: 1, KL: -2 });
  expect(speziesModifikatoren(auelfenEW, 'KK')).toEqual({ IN: 1, GE: 1, KK: -2 });
  // Choosing an attribute that isn't offered by the choice group resolves nothing extra.
  expect(speziesModifikatoren(auelfenEW, 'MU')).toEqual({ IN: 1, GE: 1 });
});

test('unconditional EW pairs apply regardless of speziesAbzug', () => {
  const ew = [['Eig7', 2], ['Eig4', -2]]; // KO +2, CH -2, no choice group
  expect(speziesModifikatoren(ew, null)).toEqual({ KO: 2, CH: -2 });
});

test('speziesModifikatoren tolerates missing/malformed EW data', () => {
  expect(speziesModifikatoren(undefined, null)).toEqual({});
  expect(speziesModifikatoren(null, null)).toEqual({});
  expect(speziesModifikatoren([], 'MU')).toEqual({});
});

test('eigenschaftenFinal is purchased plus modifiers per attribute, independent otherwise', () => {
  const held = leererHeld('EG2');
  held.eigenschaftenGekauft = { MU: 8, KL: 8, IN: 8, CH: 8, FF: 8, GE: 8, KO: 8, KK: 8 };
  expect(eigenschaftenFinal(held, undefined)).toEqual(held.eigenschaftenGekauft);
});
