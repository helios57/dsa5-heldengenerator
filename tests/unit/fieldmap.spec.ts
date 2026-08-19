import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { heldZuFeldern, felderZuHeld } from '../../src/io/fieldmap.ts';
import { leererHeld } from '../../src/core/character.ts';
import { PDFDoc } from '../../src/io/pdf-document.ts';
import { readAcroFields } from '../../src/io/pdf-acroform.ts';
import { SOURCE_PDF } from '../../tools/paths.ts';
import type {
  DatenIndex, SpeziesEintrag, KulturEintrag, ProfessionEintrag, TalentEintrag,
  KampftechnikEintrag, EigenheitEintrag, ZauberLiturgieEintrag,
} from '../../src/core/apkonto.ts';

// --- lokal erweiterte Test-Einträge (dieselben Zusatzfelder, die fieldmap.ts erwartet;
// s. Kommentar dort: DatenIndex selbst kennt nur, was apKonto() für die AP-Rechnung braucht). ---
type SpeziesTest = SpeziesEintrag & {
  EW?: unknown; 'Name divers'?: string; LE?: number; SK?: number; ZK?: number; GS?: number;
};
type KulturTest = KulturEintrag & { 'Name Plural'?: string };
type EigenheitTest = EigenheitEintrag & { 'Name divers'?: string };
type ZauberLiturgieTest = ZauberLiturgieEintrag & { Name?: string };
type ProfessionTest = ProfessionEintrag & { LeitMagie?: string; LeitKarma?: string };

type MutableDatenIndex = {
  spezies: Map<string, SpeziesTest>;
  kulturen: Map<string, KulturTest>;
  professionen: Map<string, ProfessionTest>;
  talente: Map<string, TalentEintrag>;
  kampftechniken: Map<string, KampftechnikEintrag>;
  vorteile: Map<string, EigenheitTest>;
  nachteile: Map<string, EigenheitTest>;
  zauber: Map<string, ZauberLiturgieTest>;
  liturgien: Map<string, ZauberLiturgieTest>;
};

// `Map<string, X & {...}>` is structurally assignable to `ReadonlyMap<string, X>` (covariant
// return type of `.get()`), so this satisfies `DatenIndex` without any cast — same pattern as
// apkonto.spec.ts's `leererDatenIndex()`.
function leererDatenIndex(): MutableDatenIndex {
  return {
    spezies: new Map(), kulturen: new Map(), professionen: new Map(), talente: new Map(),
    kampftechniken: new Map(), vorteile: new Map(), nachteile: new Map(), zauber: new Map(),
    liturgien: new Map(),
  };
}

// Real Auelfen entry (S2) from app/data/spezies.json — same EW used in character.spec.ts's
// "Auelfin trap" test: IN +1, GE +1, choice of KL-2 or KK-2.
const AUELFEN_EW = [['Eig3', 1], ['Eig6', 1], [['Eig2', -2], ['Eig8', -2]]];

function datenMitAuelfen(): MutableDatenIndex {
  const daten = leererDatenIndex();
  daten.spezies.set('S2', {
    AP: -12, EW: AUELFEN_EW, 'Name divers': 'Elf:e (Auelf:e)', LE: 2, SK: -4, ZK: -6, GS: 8,
  });
  return daten;
}

test('heldZuFeldern maps an umlaut name and species-final MU for a known species', () => {
  const held = leererHeld('EG2');
  held.meta.name = 'Bjørn Wåldemär';
  held.spezies = 'S2';
  held.eigenschaftenGekauft = { ...held.eigenschaftenGekauft, MU: 12 };

  const felder = new Set(['Held_Name', 'MU_1']);
  const map = heldZuFeldern(held, datenMitAuelfen(), felder);

  expect(map.get('Held_Name')).toBe('Bjørn Wåldemär');
  // Auelfen EW carries no MU modifier, so final MU === purchased MU.
  expect(map.get('MU_1')).toBe('12');
});

test('a field absent from `felder` is silently skipped, not written', () => {
  const held = leererHeld('EG2');
  held.meta.familie = 'von Gareth';
  const felder = new Set(['Held_Name']); // Held_Familie deliberately absent
  const map = heldZuFeldern(held, leererDatenIndex(), felder);
  expect(map.has('Held_Familie')).toBe(false);
  expect(map.size).toBeLessThanOrEqual(felder.size);
});

test('LE_* carries the basiswerte()-computed value: Zwerge (species LE base 8), final KO 13 -> LE 34', () => {
  const daten = leererDatenIndex();
  // Real Zwerge entry (S27): LE base 8, EW gives KO +1 (Eig7) and KK +1 (Eig8), plus a
  // CH-2/GE-2 choice group. Purchased KO 12 + unconditional +1 -> final KO 13.
  daten.spezies.set('S27', {
    AP: 25, EW: [['Eig7', 1], ['Eig8', 1], [['Eig4', -2], ['Eig6', -2]]],
    'Name divers': 'Zwerg:in', LE: 8, SK: -4, ZK: -4, GS: 6,
  });
  const held = leererHeld('EG2');
  held.spezies = 'S27';
  held.eigenschaftenGekauft = { ...held.eigenschaftenGekauft, KO: 12 };

  const felder = new Set(['LE_Wert_1', 'LE_Max_1', 'LE_Max_2', 'LE_Max_3']);
  const map = heldZuFeldern(held, daten, felder);

  expect(map.get('LE_Wert_1')).toBe('34');
  expect(map.get('LE_Max_1')).toBe('34');
  expect(map.get('LE_Max_2')).toBe('34');
  expect(map.get('LE_Max_3')).toBe('34');
});

test('LE_Max_* includes zugekaufte (purchased) extra LE on top of the Grundwert', () => {
  const daten = leererDatenIndex();
  daten.spezies.set('S27', { AP: 25, EW: [], LE: 8, SK: -4, ZK: -4, GS: 6 });
  const held = leererHeld('EG2');
  held.spezies = 'S27';
  held.eigenschaftenGekauft = { ...held.eigenschaftenGekauft, KO: 13 };
  held.energienKauf = { le: 5, ae: 0, ke: 0 };

  const map = heldZuFeldern(held, daten, new Set(['LE_Wert_1', 'LE_Max_1']));
  expect(map.get('LE_Wert_1')).toBe('34'); // Grundwert, ohne Kauf
  expect(map.get('LE_Max_1')).toBe('39');  // 34 + 5 zugekaufte LE
});

test('LE_* is skipped when the species is unresolvable (no Grundwerte known)', () => {
  const held = leererHeld('EG2');
  held.spezies = 'unbekannt';
  const map = heldZuFeldern(held, leererDatenIndex(), new Set(['LE_Wert_1']));
  expect(map.has('LE_Wert_1')).toBe(false);
});

test('AW_/INI_ are always computed, independent of species (no Grundwerte needed)', () => {
  const held = leererHeld('EG2');
  held.eigenschaftenGekauft = { MU: 13, KL: 8, IN: 8, CH: 8, FF: 8, GE: 13, KO: 8, KK: 8 };
  const map = heldZuFeldern(held, leererDatenIndex(), new Set(['AW_Wert_1', 'INI_Wert_1']));
  expect(map.get('AW_Wert_1')).toBe('7');  // round(13/2) = 7
  expect(map.get('INI_Wert_1')).toBe('13'); // round((13+13)/2) = 13
});

test('AE_* is written only when a magical tradition is present, using the profession Leitwert', () => {
  const daten = leererDatenIndex();
  daten.professionen.set('Gildenmagier:in', { Gesamt: '400', LeitMagie: 'KL' });
  const held = leererHeld('EG2');
  held.profession = 'Gildenmagier:in';
  held.eigenschaftenGekauft = { ...held.eigenschaftenGekauft, KL: 15 };
  held.traditionMagisch = 'Gildenmagier';

  const mitTradition = heldZuFeldern(held, daten, new Set(['AE_Wert_1']));
  expect(mitTradition.get('AE_Wert_1')).toBe('35'); // 20 + Leitwert 15

  held.traditionMagisch = null;
  const ohneTradition = heldZuFeldern(held, daten, new Set(['AE_Wert_1']));
  expect(ohneTradition.has('AE_Wert_1')).toBe(false);
});

test('AP_gesamt/AP_ausgegeben reflect apKonto()', () => {
  const held = leererHeld('EG2');
  const map = heldZuFeldern(held, leererDatenIndex(), new Set(['AP_gesamt', 'AP_ausgegeben']));
  expect(map.get('AP_gesamt')).toBe('1100');
  expect(map.get('AP_ausgegeben')).toBe('0');
});

test('Talent_FW_<n> is generated from the talente dataset, not hardcoded', () => {
  const daten = leererDatenIndex();
  daten.talente.set('Tal1', { SF: 'B', Aktivieren: 'nein' });
  daten.talente.set('Tal61', { SF: 'C', Aktivieren: 'ja' });
  const held = leererHeld('EG2');
  held.fertigkeiten = { Tal1: 7, Tal61: 3 };

  const map = heldZuFeldern(held, daten, new Set(['Talent_FW_1', 'Talent_FW_61']));
  expect(map.get('Talent_FW_1')).toBe('7');
  expect(map.get('Talent_FW_61')).toBe('3');
});

test('Kampftechniken fill KaT_Name_<n>/KaT_FW_<n> row by row', () => {
  const daten = leererDatenIndex();
  daten.kampftechniken.set('Dolche', { SF: 'B' });
  const held = leererHeld('EG2');
  held.kampftechniken = { Dolche: 9 };

  const map = heldZuFeldern(held, daten, new Set(['KaT_Name_1', 'KaT_FW_1']));
  expect(map.get('KaT_Name_1')).toBe('Dolche');
  expect(map.get('KaT_FW_1')).toBe('9');
});

test('Vorteile fill Vorteil_<n> with the display name and Vorteil_Er_<n> with the extension', () => {
  const daten = leererDatenIndex();
  daten.vorteile.set('VT227', { BasisKosten: '5', 'Name divers': 'Zusätzliche Gliedmaßen' });
  const held = leererHeld('EG2');
  held.vorteile = [{ id: 'VT227', erweiterung: 'VT227_1' }];

  const map = heldZuFeldern(held, daten, new Set(['Vorteil_1', 'Vorteil_Er_1']));
  expect(map.get('Vorteil_1')).toBe('Zusätzliche Gliedmaßen');
  expect(map.get('Vorteil_Er_1')).toBe('VT227_1');
});

test('an unresolvable Vorteil id falls back to writing the raw id', () => {
  const held = leererHeld('EG2');
  held.vorteile = [{ id: 'VT_unbekannt' }];
  const map = heldZuFeldern(held, leererDatenIndex(), new Set(['Vorteil_1']));
  expect(map.get('Vorteil_1')).toBe('VT_unbekannt');
});

test('Zauber fill Zauber_<n>/Z_FW_<n> with the display name and value', () => {
  const daten = leererDatenIndex();
  daten.zauber.set('Z_1', { SF: 'B', Name: 'Blut trinken' });
  const held = leererHeld('EG2');
  held.zauber = { Z_1: 6 };

  const map = heldZuFeldern(held, daten, new Set(['Zauber_1', 'Z_FW_1']));
  expect(map.get('Zauber_1')).toBe('Blut trinken');
  expect(map.get('Z_FW_1')).toBe('6');
});

// --- Round-trip through the REAL PDF field names ---------------------------------------------

let felder: Set<string>;
test.beforeAll(async () => {
  const doc = await PDFDoc.load(new Uint8Array(await readFile(SOURCE_PDF)));
  const fields = await readAcroFields(doc);
  felder = new Set(fields.keys());
});

test('round-trips identity, and recovers PURCHASED attributes for a species with modifiers (Auelfin: final IN 15, Eig3 +1 -> purchased IN 14)', () => {
  const daten = datenMitAuelfen();
  const held = leererHeld('EG2');
  held.meta.name = 'Yldûr Wîndhauch';
  held.meta.familie = 'Wîndhauch';
  held.spezies = 'S2';
  held.speziesAbzug = 'KL'; // resolves the Auelfen choice; irrelevant to IN (unconditional +1)
  // Purchased IN 14 (at the Erfahren cap) + Elfen unconditional +1 IN -> final IN 15.
  held.eigenschaftenGekauft = { MU: 8, KL: 10, IN: 14, CH: 8, FF: 8, GE: 8, KO: 8, KK: 8 };

  const map = heldZuFeldern(held, daten, felder);
  expect(map.get('Held_Name')).toBe('Yldûr Wîndhauch');
  expect(map.get('IN_1')).toBe('15'); // final, as displayed on the real sheet

  const zurueck = felderZuHeld(map, daten);
  expect(zurueck.meta.name).toBe('Yldûr Wîndhauch');
  expect(zurueck.meta.familie).toBe('Wîndhauch');
  expect(zurueck.spezies).toBe('S2');
  // The trap this guards against: recovering the FINAL value (15) instead of the PURCHASED
  // one (14) would silently fail Erfahren's eigenschaft-max cap of 14 (see character.spec.ts).
  expect(zurueck.eigenschaftenGekauft.IN).toBe(14);
  expect(zurueck.eigenschaftenGekauft.MU).toBe(8);
});

test('round-trips fertigkeiten, kampftechniken, vorteile, nachteile, zauber and liturgien through the real sheet', () => {
  const daten = leererDatenIndex();
  daten.talente.set('Tal1', { SF: 'B', Aktivieren: 'nein' });
  daten.kampftechniken.set('Dolche', { SF: 'B' });
  daten.vorteile.set('VT1', { BasisKosten: '5', 'Name divers': 'Adel I' });
  daten.nachteile.set('NT1', { BasisKosten: '-2', 'Name divers': 'Angst (Spinnen)' });
  daten.zauber.set('Z_1', { SF: 'B', Name: 'Blut trinken' });
  daten.liturgien.set('L_1', { SF: 'B', Name: 'Angriffslust' });

  const held = leererHeld('EG2');
  held.fertigkeiten = { Tal1: 8 };
  held.kampftechniken = { Dolche: 11 };
  held.vorteile = [{ id: 'VT1' }];
  held.nachteile = [{ id: 'NT1', erweiterung: 'Spinnen' }];
  held.zauber = { Z_1: 9 };
  held.liturgien = { L_1: 5 };

  const map = heldZuFeldern(held, daten, felder);
  const zurueck = felderZuHeld(map, daten);

  expect(zurueck.fertigkeiten['Tal1']).toBe(8);
  expect(zurueck.kampftechniken['Dolche']).toBe(11);
  expect(zurueck.vorteile).toEqual([{ id: 'VT1' }]);
  expect(zurueck.nachteile).toEqual([{ id: 'NT1', erweiterung: 'Spinnen' }]);
  expect(zurueck.zauber['Z_1']).toBe(9);
  expect(zurueck.liturgien['L_1']).toBe(5);
});

test('felderZuHeld on an empty/unfilled sheet (no values) yields a valid leererHeld()-shaped hero', () => {
  const leer = new Map<string, string>();
  const held = felderZuHeld(leer, leererDatenIndex());
  expect(held.meta.name).toBe('');
  expect(held.spezies).toBeNull();
  expect(held.vorteile).toEqual([]);
  expect(held.fertigkeiten).toEqual({});
});
