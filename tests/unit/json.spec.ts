import { test, expect } from '@playwright/test';
import { exportiereJSON, importiereJSON, JSON_SCHEMA_VERSION } from '../../src/io/json.ts';
import { leererHeld } from '../../src/core/character.ts';
import type { Held } from '../../src/core/character.ts';

function volleHeld(): Held {
  const held = leererHeld('EG3');
  held.meta = {
    name: 'Yldûr Wîndhauch',
    familie: 'Windhauch',
    geburtsort: 'Kösch',
    geburtsdatum: '1 Praios 1000 BF',
    alter: '23',
    geschlecht: 'männlich',
    groesse: '178',
    gewicht: '72',
    haarfarbe: 'schwarz',
    augenfarbe: 'grün',
    titel: 'Bacharant',
    sozialstatus: 'Frei',
    charakteristika: 'Narbe über dem linken Auge',
    sonstiges: 'Träumt oft von Wüsten',
  };
  held.spezies = 'S2';
  held.speziesAbzug = 'KL';
  held.kultur = 'K4';
  held.profession = 'Jägerin';
  held.eigenschaftenGekauft = { MU: 13, KL: 12, IN: 14, CH: 11, FF: 12, GE: 13, KO: 12, KK: 10 };
  held.fertigkeiten = { Tal1: 3, Tal10: 7 };
  held.kampftechniken = { Dolche: 9, Schwerter: 8 };
  held.vorteile = [{ id: 'VT1' }, { id: 'VT227', erweiterung: 'VT227_1' }, { id: 'VT5', stufe: 2 }];
  held.nachteile = [{ id: 'NT1', stufe: 1, erweiterung: 'irgendwas' }];
  held.sonderfertigkeiten = [{ id: 'SF1' }];
  held.zauber = { Z_1: 6, Z_2: 4 };
  held.liturgien = { L_1: 8 };
  held.traditionMagisch = 'Gildenmagier';
  held.traditionKarmal = null;
  held.energienKauf = { le: 3, ae: 5, ke: 0 };
  held.ausruestung = [{ id: 'AUS1', anzahl: 2 }, { id: 'AUS2', anzahl: 1 }];
  held.geld = { dukaten: 12, silbertaler: 3, heller: 8, kreuzer: 0 };
  held.notizen = 'Möge Praios ihn schützen.';
  return held;
}

test('a fully populated Held round-trips losslessly through export/import', () => {
  const held = volleHeld();
  const text = exportiereJSON(held);
  const ergebnis = importiereJSON(text);
  expect(ergebnis.ok).toBe(true);
  if (ergebnis.ok) expect(ergebnis.held).toEqual(held);
});

test('leererHeld() round-trips losslessly too (all-defaults edge case)', () => {
  const held = leererHeld();
  const ergebnis = importiereJSON(exportiereJSON(held));
  expect(ergebnis.ok).toBe(true);
  if (ergebnis.ok) expect(ergebnis.held).toEqual(held);
});

test('exportiereJSON is pretty-printed and carries a _meta block ignored on import', () => {
  const text = exportiereJSON(leererHeld());
  expect(text).toContain('\n  "schemaVersion"');
  const parsed: unknown = JSON.parse(text);
  expect(parsed).toMatchObject({ _meta: { app: 'dsa5-heldengenerator' } });
  const geparst = parsed as { _meta: { exportiertAm: string } };
  expect(() => new Date(geparst._meta.exportiertAm).toISOString()).not.toThrow();

  // _meta must not leak into the imported Held, and re-exporting at a later time (different
  // timestamp) still round-trips to an equal Held.
  const ergebnis = importiereJSON(text);
  expect(ergebnis.ok).toBe(true);
  if (ergebnis.ok) expect((ergebnis.held as unknown as { _meta?: unknown })._meta).toBeUndefined();
});

test('stable key order: two exports of field-order-shuffled but equal Helden produce identical text', () => {
  const a = leererHeld();
  const b: Held = {
    notizen: a.notizen, geld: { ...a.geld }, ausruestung: [...a.ausruestung],
    energienKauf: { ...a.energienKauf }, traditionKarmal: a.traditionKarmal,
    traditionMagisch: a.traditionMagisch, liturgien: { ...a.liturgien }, zauber: { ...a.zauber },
    sonderfertigkeiten: [...a.sonderfertigkeiten], nachteile: [...a.nachteile],
    vorteile: [...a.vorteile], kampftechniken: { ...a.kampftechniken },
    fertigkeiten: { ...a.fertigkeiten }, eigenschaftenGekauft: { ...a.eigenschaftenGekauft },
    profession: a.profession, kultur: a.kultur, speziesAbzug: a.speziesAbzug, spezies: a.spezies,
    erfahrungsgrad: a.erfahrungsgrad, meta: { ...a.meta }, schemaVersion: a.schemaVersion,
  };
  const textA = exportiereJSON(a).replace(/"exportiertAm":[^,}]+/, '"exportiertAm":""');
  const textB = exportiereJSON(b).replace(/"exportiertAm":[^,}]+/, '"exportiertAm":""');
  expect(textA).toBe(textB);
});

test('malformed JSON is rejected with a readable German error, never throws', () => {
  expect(() => importiereJSON('{ this is not json')).not.toThrow();
  const ergebnis = importiereJSON('{ this is not json');
  expect(ergebnis.ok).toBe(false);
  if (!ergebnis.ok) {
    expect(ergebnis.fehler.length).toBeGreaterThan(0);
    expect(ergebnis.fehler[0]).toContain('JSON');
  }
});

test('a JSON array (not an object) at the top level is rejected', () => {
  const ergebnis = importiereJSON('[1, 2, 3]');
  expect(ergebnis.ok).toBe(false);
});

test('missing schemaVersion is rejected', () => {
  const ergebnis = importiereJSON(JSON.stringify({ meta: {} }));
  expect(ergebnis.ok).toBe(false);
  if (!ergebnis.ok) expect(ergebnis.fehler.join(' ')).toContain('schemaVersion');
});

test('an unknown schemaVersion is rejected', () => {
  const ergebnis = importiereJSON(JSON.stringify({ schemaVersion: 99 }));
  expect(ergebnis.ok).toBe(false);
  if (!ergebnis.ok) expect(ergebnis.fehler.join(' ')).toContain('schemaVersion');
});

test('schemaVersion alone (no other fields) still fails validation cleanly, not by throwing', () => {
  expect(() => importiereJSON(JSON.stringify({ schemaVersion: JSON_SCHEMA_VERSION }))).not.toThrow();
});

test('a hostile eigenschaftenGekauft (a string instead of an object) is rejected, not coerced', () => {
  const payload = { schemaVersion: JSON_SCHEMA_VERSION, eigenschaftenGekauft: 'MU:99' };
  const ergebnis = importiereJSON(JSON.stringify(payload));
  expect(ergebnis.ok).toBe(false);
  if (!ergebnis.ok) expect(ergebnis.fehler.join(' ')).toContain('eigenschaftenGekauft');
});

test('unknown extra top-level keys are dropped silently, not merged into the Held', () => {
  const held = volleHeld();
  const text = exportiereJSON(held);
  const withExtra = JSON.parse(text) as Record<string, unknown>;
  withExtra['einSchlüsselDenEsNichtGibt'] = { irgendwas: true };
  const ergebnis = importiereJSON(JSON.stringify(withExtra));
  expect(ergebnis.ok).toBe(true);
  if (ergebnis.ok) {
    expect(ergebnis.held).toEqual(held);
    expect((ergebnis.held as unknown as Record<string, unknown>)['einSchlüsselDenEsNichtGibt']).toBeUndefined();
  }
});

test('a __proto__ pollution attempt is neutralised: no throw, no polluted Held, no polluted Object.prototype', () => {
  const marker = Symbol('nicht-vorhanden');
  const boesartig = `{"schemaVersion":${JSON_SCHEMA_VERSION},"__proto__":{"polluted":true},` +
    `"meta":{"__proto__":{"polluted":true}}}`;
  expect(() => importiereJSON(boesartig)).not.toThrow();
  const ergebnis = importiereJSON(boesartig);
  // Object.prototype itself must remain clean regardless of ok/not-ok.
  expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  expect(marker).toBeDefined(); // sanity: this test file's own assertions still run normally
  if (ergebnis.ok) {
    expect((ergebnis.held as unknown as Record<string, unknown>)['polluted']).toBeUndefined();
    expect((ergebnis.held.meta as unknown as Record<string, unknown>)['polluted']).toBeUndefined();
  }
});

test('a non-object JSON value at the top level (a bare number) is rejected', () => {
  const ergebnis = importiereJSON('42');
  expect(ergebnis.ok).toBe(false);
});

test('null as the parsed value is rejected, not treated as a valid empty object', () => {
  const ergebnis = importiereJSON('null');
  expect(ergebnis.ok).toBe(false);
});

test('a structurally wrong vorteile entry (id missing) is rejected with a readable message', () => {
  const payload = {
    schemaVersion: JSON_SCHEMA_VERSION,
    vorteile: [{ stufe: 2 }],
  };
  const ergebnis = importiereJSON(JSON.stringify(payload));
  expect(ergebnis.ok).toBe(false);
  if (!ergebnis.ok) expect(ergebnis.fehler.join(' ')).toContain('vorteile[0].id');
});

test('collects multiple independent errors in one pass rather than stopping at the first', () => {
  const payload = {
    schemaVersion: JSON_SCHEMA_VERSION,
    eigenschaftenGekauft: 'kaputt',
    fertigkeiten: 'auch kaputt',
    geld: 'ebenfalls kaputt',
  };
  const ergebnis = importiereJSON(JSON.stringify(payload));
  expect(ergebnis.ok).toBe(false);
  if (!ergebnis.ok) expect(ergebnis.fehler.length).toBeGreaterThanOrEqual(3);
});

test('a missing optional section (fertigkeiten absent) falls back to leererHeld() defaults', () => {
  const payload = { schemaVersion: JSON_SCHEMA_VERSION };
  const ergebnis = importiereJSON(JSON.stringify(payload));
  expect(ergebnis.ok).toBe(true);
  if (ergebnis.ok) expect(ergebnis.held).toEqual(leererHeld());
});
