import { test, expect } from '@playwright/test';
import {
  erzeugeStore, SPEICHER_SCHLUESSEL, ladeGespeicherten, speichere, loescheSpeicher,
} from '../../src/state/store.ts';
import { leererHeld } from '../../src/core/character.ts';

// `localStorage` existiert unter Node/Playwright (kein Browser) nicht global — jeder Test,
// der Persistenz betrifft, installiert deshalb eine In-Memory-Attrappe und stellt danach den
// ursprünglichen Zustand von `globalThis.localStorage` wieder her (auch wenn der schlicht
// "nicht vorhanden" war), damit Tests sich nicht gegenseitig über den Modul-Cache hinweg
// beeinflussen.

const localStorageDeskriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

test.afterEach(() => {
  if (localStorageDeskriptor) {
    Object.defineProperty(globalThis, 'localStorage', localStorageDeskriptor);
  } else {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  }
});

function erzeugeSpeicherAttrappe(): Storage {
  const daten = new Map<string, string>();
  const attrappe = {
    get length(): number { return daten.size; },
    clear(): void { daten.clear(); },
    getItem: (schluessel: string): string | null => daten.get(schluessel) ?? null,
    key: (index: number): string | null => Array.from(daten.keys())[index] ?? null,
    removeItem: (schluessel: string): void => { daten.delete(schluessel); },
    setItem: (schluessel: string, wert: string): void => { daten.set(schluessel, wert); },
  };
  return attrappe as unknown as Storage;
}

// --- Undo/Redo ---

test('rueckgaengig/wiederholen navigieren mehrere Bearbeitungen', () => {
  const store = erzeugeStore(leererHeld());
  store.setze((h) => ({ ...h, notizen: 'eins' }));
  store.setze((h) => ({ ...h, notizen: 'zwei' }));
  store.setze((h) => ({ ...h, notizen: 'drei' }));
  expect(store.held().notizen).toBe('drei');

  expect(store.rueckgaengig()).toBe(true);
  expect(store.held().notizen).toBe('zwei');
  expect(store.rueckgaengig()).toBe(true);
  expect(store.held().notizen).toBe('eins');
  expect(store.rueckgaengig()).toBe(true);
  expect(store.held().notizen).toBe(''); // Ausgangszustand
  expect(store.rueckgaengig()).toBe(false); // nichts mehr rückgängig zu machen
  expect(store.held().notizen).toBe('');

  expect(store.wiederholen()).toBe(true);
  expect(store.held().notizen).toBe('eins');
  expect(store.wiederholen()).toBe(true);
  expect(store.held().notizen).toBe('zwei');
  expect(store.wiederholen()).toBe(true);
  expect(store.held().notizen).toBe('drei');
  expect(store.wiederholen()).toBe(false);
});

test('kannRueckgaengig/kannWiederholen melden den Zustand korrekt', () => {
  const store = erzeugeStore(leererHeld());
  expect(store.kannRueckgaengig()).toBe(false);
  expect(store.kannWiederholen()).toBe(false);
  store.setze((h) => ({ ...h, notizen: 'x' }));
  expect(store.kannRueckgaengig()).toBe(true);
  expect(store.kannWiederholen()).toBe(false);
  store.rueckgaengig();
  expect(store.kannRueckgaengig()).toBe(false);
  expect(store.kannWiederholen()).toBe(true);
});

test('eine neue Bearbeitung nach rueckgaengig löscht den Wiederholen-Stapel', () => {
  const store = erzeugeStore(leererHeld());
  store.setze((h) => ({ ...h, notizen: 'eins' }));
  store.setze((h) => ({ ...h, notizen: 'zwei' }));
  store.rueckgaengig();
  expect(store.kannWiederholen()).toBe(true);
  store.setze((h) => ({ ...h, notizen: 'anders' }));
  expect(store.kannWiederholen()).toBe(false);
  expect(store.wiederholen()).toBe(false);
});

test('ersetze legt ebenfalls einen Undo-Punkt an', () => {
  const store = erzeugeStore(leererHeld());
  const importiert = { ...leererHeld(), notizen: 'importiert' };
  store.ersetze(importiert);
  expect(store.held()).toEqual(importiert);
  expect(store.rueckgaengig()).toBe(true);
  expect(store.held().notizen).toBe('');
});

test('der Undo-Stapel ist auf 50 Einträge gedeckelt', () => {
  const store = erzeugeStore(leererHeld());
  for (let i = 0; i < 60; i++) {
    store.setze((h) => ({ ...h, notizen: String(i) }));
  }
  let anzahlRueckgaengig = 0;
  while (store.rueckgaengig()) anzahlRueckgaengig++;
  expect(anzahlRueckgaengig).toBe(50);
  expect(store.held().notizen).toBe('9'); // ältere Zwischenstände wurden verworfen
});

// --- Subscriptions ---

test('abonniere benachrichtigt bei jeder Änderung; die Rückgabe meldet ab', () => {
  const store = erzeugeStore(leererHeld());
  const gesehen: string[] = [];
  const abbestellen = store.abonniere((h) => gesehen.push(h.notizen));
  store.setze((h) => ({ ...h, notizen: 'a' }));
  store.setze((h) => ({ ...h, notizen: 'b' }));
  expect(gesehen).toEqual(['a', 'b']);
  abbestellen();
  store.setze((h) => ({ ...h, notizen: 'c' }));
  expect(gesehen).toEqual(['a', 'b']); // keine weitere Benachrichtigung nach Abbestellung
});

test('rueckgaengig, wiederholen und ersetze benachrichtigen ebenfalls', () => {
  const store = erzeugeStore(leererHeld());
  const gesehen: string[] = [];
  store.abonniere((h) => gesehen.push(h.notizen));
  store.setze((h) => ({ ...h, notizen: 'a' }));
  store.rueckgaengig();
  store.wiederholen();
  store.ersetze({ ...leererHeld(), notizen: 'importiert' });
  expect(gesehen).toEqual(['a', '', 'a', 'importiert']);
});

test('mehrere Abonnenten werden unabhängig voneinander benachrichtigt', () => {
  const store = erzeugeStore(leererHeld());
  const a: string[] = [];
  const b: string[] = [];
  store.abonniere((h) => a.push(h.notizen));
  const abbestellenB = store.abonniere((h) => b.push(h.notizen));
  store.setze((h) => ({ ...h, notizen: 'x' }));
  abbestellenB();
  store.setze((h) => ({ ...h, notizen: 'y' }));
  expect(a).toEqual(['x', 'y']);
  expect(b).toEqual(['x']);
});

// --- Autosave (debounced, ~300ms) ---

test('setze löst Autosave erst nach der Verzögerung aus, nicht sofort, nicht mehrfach', async () => {
  const attrappe = erzeugeSpeicherAttrappe();
  globalThis.localStorage = attrappe;
  const store = erzeugeStore(leererHeld());
  store.setze((h) => ({ ...h, notizen: 'a' }));
  store.setze((h) => ({ ...h, notizen: 'b' }));
  store.setze((h) => ({ ...h, notizen: 'c' }));
  expect(attrappe.getItem(SPEICHER_SCHLUESSEL)).toBeNull(); // noch nicht gespeichert
  await new Promise((resolve) => setTimeout(resolve, 400));
  const gespeichert = attrappe.getItem(SPEICHER_SCHLUESSEL);
  expect(gespeichert).not.toBeNull();
  expect(JSON.parse(gespeichert!)).toMatchObject({ notizen: 'c' }); // nur der letzte Stand
});

// --- ladeGespeicherten: defensiv, wirft nie ---

test('ladeGespeicherten liefert null für ungültiges JSON, ohne zu werfen', () => {
  const attrappe = erzeugeSpeicherAttrappe();
  attrappe.setItem(SPEICHER_SCHLUESSEL, '{ das ist kaputtes JSON');
  globalThis.localStorage = attrappe;
  expect(() => ladeGespeicherten()).not.toThrow();
  expect(ladeGespeicherten()).toBeNull();
});

test('ladeGespeicherten liefert null für gespeichertes "null"', () => {
  const attrappe = erzeugeSpeicherAttrappe();
  attrappe.setItem(SPEICHER_SCHLUESSEL, 'null');
  globalThis.localStorage = attrappe;
  expect(ladeGespeicherten()).toBeNull();
});

test('ladeGespeicherten liefert null für ein Array', () => {
  const attrappe = erzeugeSpeicherAttrappe();
  attrappe.setItem(SPEICHER_SCHLUESSEL, JSON.stringify([1, 2, 3]));
  globalThis.localStorage = attrappe;
  expect(ladeGespeicherten()).toBeNull();
});

test('ladeGespeicherten liefert null, wenn eigenschaftenGekauft fehlt', () => {
  const attrappe = erzeugeSpeicherAttrappe();
  const kaputt: Record<string, unknown> = { ...leererHeld() };
  delete kaputt['eigenschaftenGekauft'];
  attrappe.setItem(SPEICHER_SCHLUESSEL, JSON.stringify(kaputt));
  globalThis.localStorage = attrappe;
  expect(ladeGespeicherten()).toBeNull();
});

test('ladeGespeicherten liefert null bei einem unvollständigen (partiellen) Eigenschaften-Satz', () => {
  // Genau der in character.ts/limits.ts (Ruling R13) dokumentierte Fall: ein korrupter
  // Autosave-Fund mit nur einem Teil der acht Eigenschaften darf niemals als gültiger
  // Held durchgehen.
  const attrappe = erzeugeSpeicherAttrappe();
  const kaputt = { ...leererHeld(), eigenschaftenGekauft: { MU: 12, KL: 13 } };
  attrappe.setItem(SPEICHER_SCHLUESSEL, JSON.stringify(kaputt));
  globalThis.localStorage = attrappe;
  expect(ladeGespeicherten()).toBeNull();
});

test('speichere/ladeGespeicherten-Roundtrip liefert einen gültigen Helden zurück', () => {
  const attrappe = erzeugeSpeicherAttrappe();
  globalThis.localStorage = attrappe;
  const held = { ...leererHeld(), notizen: 'Testnotiz' };
  speichere(held);
  expect(ladeGespeicherten()).toEqual(held);
});

test('loescheSpeicher entfernt den gespeicherten Helden', () => {
  const attrappe = erzeugeSpeicherAttrappe();
  globalThis.localStorage = attrappe;
  speichere(leererHeld());
  expect(attrappe.getItem(SPEICHER_SCHLUESSEL)).not.toBeNull();
  loescheSpeicher();
  expect(attrappe.getItem(SPEICHER_SCHLUESSEL)).toBeNull();
});

// --- localStorage nicht verfügbar oder wirft: nie eine Exception nach außen tragen ---

test('speichere wirft nicht, selbst wenn localStorage.setItem wirft (z. B. Kontingent voll)', () => {
  const werfendeAttrappe = {
    length: 0,
    clear(): void {},
    getItem: (): string | null => null,
    key: (): string | null => null,
    removeItem(): void {},
    setItem: (): void => { throw new Error('QuotaExceededError'); },
  };
  globalThis.localStorage = werfendeAttrappe as unknown as Storage;
  expect(() => speichere(leererHeld())).not.toThrow();
});

test('ladeGespeicherten/speichere/loescheSpeicher werfen nicht, wenn localStorage ganz fehlt', () => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
  expect(() => speichere(leererHeld())).not.toThrow();
  expect(ladeGespeicherten()).toBeNull();
  expect(() => loescheSpeicher()).not.toThrow();
});
