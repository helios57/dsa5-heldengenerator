import { test, expect } from '@playwright/test';
import { apKonto } from '../../src/core/apkonto.ts';
import type {
  DatenIndex, SpeziesEintrag, KulturEintrag, ProfessionEintrag, TalentEintrag,
  KampftechnikEintrag, EigenheitEintrag, ZauberLiturgieEintrag,
} from '../../src/core/apkonto.ts';
import { leererHeld } from '../../src/core/character.ts';

type MutableDatenIndex = {
  spezies: Map<string, SpeziesEintrag>;
  kulturen: Map<string, KulturEintrag>;
  professionen: Map<string, ProfessionEintrag>;
  talente: Map<string, TalentEintrag>;
  kampftechniken: Map<string, KampftechnikEintrag>;
  vorteile: Map<string, EigenheitEintrag>;
  nachteile: Map<string, EigenheitEintrag>;
  zauber: Map<string, ZauberLiturgieEintrag>;
  liturgien: Map<string, ZauberLiturgieEintrag>;
};

// Returned as a mutable index (not `DatenIndex`) so each test can populate only the maps
// it needs with plain `.set(...)` calls; `Map` is structurally assignable to `ReadonlyMap`,
// so this satisfies `apKonto`'s `daten: DatenIndex` parameter without any cast.
function leererDatenIndex(): MutableDatenIndex {
  return {
    spezies: new Map<string, SpeziesEintrag>(),
    kulturen: new Map<string, KulturEintrag>(),
    professionen: new Map<string, ProfessionEintrag>(),
    talente: new Map<string, TalentEintrag>(),
    kampftechniken: new Map<string, KampftechnikEintrag>(),
    vorteile: new Map<string, EigenheitEintrag>(),
    nachteile: new Map<string, EigenheitEintrag>(),
    zauber: new Map<string, ZauberLiturgieEintrag>(),
    liturgien: new Map<string, ZauberLiturgieEintrag>(),
  };
}

test('apKonto on leererHeld() spends nothing; rest equals the full Erfahrungsgrad budget', () => {
  const held = leererHeld('EG2');
  const konto = apKonto(held, leererDatenIndex());
  expect(konto.budget).toBe(1100); // EG2 "Erfahren"
  expect(konto.ausgegeben).toBe(0);
  expect(konto.rest).toBe(1100);
  expect(konto.vorteilAP).toBe(0);
  expect(konto.nachteilAP).toBe(0);
  for (const posten of konto.posten) expect(posten.ap).toBe(0);
});

test('unknown Erfahrungsgrad throws rather than silently defaulting', () => {
  const held = leererHeld('EG2');
  held.erfahrungsgrad = 'nicht-existent';
  expect(() => apKonto(held, leererDatenIndex())).toThrow();
});

// --- hand-computed hero: every number below is computed by hand in the comment next to it ---

test('a hand-computed hero totals correctly across every AP category', () => {
  const held = leererHeld('EG2');

  // Eigenschaften: MU 10 (2 Schritte * 15 = 30), IN 9 (1 Schritt * 15 = 15), rest bei 8 (0).
  // eigenschaftKosten(w) for w in 9..13 is (w-8)*15. Total = 30 + 15 = 45.
  held.eigenschaftenGekauft = { MU: 10, KL: 8, IN: 9, CH: 8, FF: 8, GE: 8, KO: 8, KK: 8 };

  // Fertigkeiten:
  //  - TalX, Spalte B (Faktor 2), FW 5, keine Aktivierung: 5 * 2 = 10
  //  - TalY, Spalte A (Faktor 1), FW 3, MIT Aktivierung: 3 * 1 + 1 (Faktor) = 4
  // Summe: 14
  held.fertigkeiten = { TalX: 5, TalY: 3 };

  // Kampftechniken: Dolche, Spalte B, FW 8 (Start 6).
  // fertigkeitKosten(8,'B') - fertigkeitKosten(6,'B') = 16 - 12 = 4
  held.kampftechniken = { Dolche: 8 };

  // Vorteile: VT1, BasisKosten "5" -> +5
  held.vorteile = [{ id: 'VT1' }];

  // Nachteile: NT1, BasisKosten "-2" (stored negative, not renegated) -> -2
  held.nachteile = [{ id: 'NT1' }];

  // Energien: 2 Punkte LE gekauft. energieKosten(2) = 2 * 4 = 8
  held.energienKauf = { le: 2, ae: 0, ke: 0 };

  const daten = leererDatenIndex();
  daten.talente.set('TalX', { SF: 'B', Aktivieren: 'nein' });
  daten.talente.set('TalY', { SF: 'A', Aktivieren: 'ja' });
  daten.kampftechniken.set('Dolche', { SF: 'B' });
  daten.vorteile.set('VT1', { BasisKosten: '5' });
  daten.nachteile.set('NT1', { BasisKosten: '-2' });

  const konto = apKonto(held, daten);

  const nachKategorie = Object.fromEntries(konto.posten.map((p) => [p.kategorie, p.ap]));
  expect(nachKategorie['Eigenschaften']).toBe(45);
  expect(nachKategorie['Fertigkeiten']).toBe(14);
  expect(nachKategorie['Kampftechniken']).toBe(4);
  expect(nachKategorie['Vorteile']).toBe(5);
  expect(nachKategorie['Nachteile']).toBe(-2);
  expect(nachKategorie['Energien']).toBe(8);
  expect(nachKategorie['Spezies']).toBe(0);
  expect(nachKategorie['Kultur']).toBe(0);
  expect(nachKategorie['Profession']).toBe(0);
  expect(nachKategorie['Sonderfertigkeiten']).toBe(0);
  expect(nachKategorie['Zauber']).toBe(0);
  expect(nachKategorie['Liturgien']).toBe(0);

  // Total: 45 + 14 + 4 + 5 - 2 + 8 = 74
  expect(konto.ausgegeben).toBe(74);
  expect(konto.budget).toBe(1100);
  expect(konto.rest).toBe(1100 - 74);

  // 80-AP-Deckel: positive Magnitude, unabhängig vom gespeicherten Vorzeichen.
  expect(konto.vorteilAP).toBe(5);
  expect(konto.nachteilAP).toBe(2);
});

test('Nachteil AP counts as a positive magnitude against the 80 AP cap despite negative storage', () => {
  const held = leererHeld('EG2');
  held.nachteile = [{ id: 'NT1' }, { id: 'NT2' }];
  const daten = leererDatenIndex();
  daten.nachteile.set('NT1', { BasisKosten: '-30' });
  daten.nachteile.set('NT2', { BasisKosten: '-15' });

  const konto = apKonto(held, daten);
  // Spent AP (refund) stays negative...
  const nachteilePosten = konto.posten.find((p) => p.kategorie === 'Nachteile');
  expect(nachteilePosten?.ap).toBe(-45);
  // ...but the cap-tracking total is the positive magnitude, 45, not -45.
  expect(konto.nachteilAP).toBe(45);
});

test('species-granted Vor-/Nachteile count toward the 80 AP caps but are not re-charged as spent AP', () => {
  const held = leererHeld('EG2');
  held.spezies = 'S99';
  const daten = leererDatenIndex();
  // Species package: 25 AP flat, includes a granted advantage and a granted disadvantage.
  daten.spezies.set('S99', { AP: 25, Vorteil: [['VT1', '']], Nachteil: [['NT1', '']] });
  daten.vorteile.set('VT1', { BasisKosten: '5' });
  daten.nachteile.set('NT1', { BasisKosten: '-2' });

  const konto = apKonto(held, daten);

  // Caps include the species-granted entries.
  expect(konto.vorteilAP).toBe(5);
  expect(konto.nachteilAP).toBe(2);

  // But they are not double-charged: the species package AP (25) already covers them, so
  // the Vorteile/Nachteile posten (player-chosen only) stay at 0, and Spezies carries the 25.
  const nachKategorie = Object.fromEntries(konto.posten.map((p) => [p.kategorie, p.ap]));
  expect(nachKategorie['Spezies']).toBe(25);
  expect(nachKategorie['Vorteile']).toBe(0);
  expect(nachKategorie['Nachteile']).toBe(0);
  expect(konto.ausgegeben).toBe(25);
});

test('Kultur and Profession package costs sum multi-part Gesamt strings ("322+130")', () => {
  const held = leererHeld('EG2');
  held.kultur = 'K1';
  held.profession = 'P1';
  const daten = leererDatenIndex();
  daten.kulturen.set('K1', { Gesamt: '55' });
  daten.professionen.set('P1', { Gesamt: '322+130' });

  const konto = apKonto(held, daten);
  const nachKategorie = Object.fromEntries(konto.posten.map((p) => [p.kategorie, p.ap]));
  expect(nachKategorie['Kultur']).toBe(55);
  expect(nachKategorie['Profession']).toBe(452);
  expect(konto.ausgegeben).toBe(507);
});

test('Zauber and Liturgien are costed with activation, like a freshly learned spell', () => {
  const held = leererHeld('EG2');
  held.zauber = { Z_1: 6 };
  held.liturgien = { L_1: 4 };
  const daten = leererDatenIndex();
  daten.zauber.set('Z_1', { SF: 'B' }); // fertigkeitKosten(6,'B',{aktivieren:true}) = 12 + 2 = 14
  daten.liturgien.set('L_1', { SF: 'C' }); // fertigkeitKosten(4,'C',{aktivieren:true}) = 12 + 3 = 15

  const konto = apKonto(held, daten);
  const nachKategorie = Object.fromEntries(konto.posten.map((p) => [p.kategorie, p.ap]));
  expect(nachKategorie['Zauber']).toBe(14);
  expect(nachKategorie['Liturgien']).toBe(15);
});

test('entries missing from the DatenIndex are skipped rather than throwing', () => {
  const held = leererHeld('EG2');
  held.fertigkeiten = { UnbekanntesTalent: 5 };
  held.kampftechniken = { UnbekannteTechnik: 8 };
  const konto = apKonto(held, leererDatenIndex());
  const nachKategorie = Object.fromEntries(konto.posten.map((p) => [p.kategorie, p.ap]));
  expect(nachKategorie['Fertigkeiten']).toBe(0);
  expect(nachKategorie['Kampftechniken']).toBe(0);
});
