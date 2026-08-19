/**
 * Heldenmodell nach DSA5 (Spec §5).
 *
 * Ruling R13 (siehe limits.ts): der Held speichert GEKAUFTE (purchased) Eigenschaftswerte
 * als "source of truth". Finale Werte (nach Spezies-Modifikatoren) werden abgeleitet und
 * dürfen den Erfahrungsgrad-Höchstwert überschreiten — das ist legal, siehe die Auelfen-Probe
 * in character.spec.ts. `pruefeEigenschaften` aus limits.ts MUSS mit `eigenschaftenGekauft`
 * aufgerufen werden, niemals mit dem Ergebnis von `eigenschaftenFinal`.
 */
import { EIGENSCHAFT_START, KAMPFTECHNIK_START, FERTIGKEIT_START } from './limits.ts';
import type { Eigenschaften, EigenschaftName } from './types.ts';

export type Held = {
  schemaVersion: 1;
  meta: {
    name: string; familie: string; geburtsort: string; geburtsdatum: string;
    alter: string; geschlecht: string; groesse: string; gewicht: string;
    haarfarbe: string; augenfarbe: string; titel: string; sozialstatus: string;
    charakteristika: string; sonstiges: string;
  };
  erfahrungsgrad: string;
  spezies: string | null;
  speziesAbzug: EigenschaftName | null;
  kultur: string | null;
  profession: string | null;
  eigenschaftenGekauft: Record<EigenschaftName, number>;
  fertigkeiten: Record<string, number>;
  kampftechniken: Record<string, number>;
  vorteile: GewaehlteEigenheit[];
  nachteile: GewaehlteEigenheit[];
  sonderfertigkeiten: GewaehlteEigenheit[];
  zauber: Record<string, number>;
  liturgien: Record<string, number>;
  traditionMagisch: string | null;
  traditionKarmal: string | null;
  energienKauf: { le: number; ae: number; ke: number };
  ausruestung: Array<{ id: string; anzahl: number }>;
  geld: { dukaten: number; silbertaler: number; heller: number; kreuzer: number };
  notizen: string;
};

export type GewaehlteEigenheit = { id: string; stufe?: number; erweiterung?: string };

const LEERE_META = Object.freeze({
  name: '', familie: '', geburtsort: '', geburtsdatum: '', alter: '', geschlecht: '',
  groesse: '', gewicht: '', haarfarbe: '', augenfarbe: '', titel: '', sozialstatus: '',
  charakteristika: '', sonstiges: '',
});

/** Eine gültige, leere Heldin/ein gültiger, leerer Held: alle Eigenschaften auf Startwert. */
export function leererHeld(erfahrungsgrad = 'EG2'): Held {
  return {
    schemaVersion: 1,
    meta: { ...LEERE_META },
    erfahrungsgrad,
    spezies: null,
    speziesAbzug: null,
    kultur: null,
    profession: null,
    eigenschaftenGekauft: {
      MU: EIGENSCHAFT_START, KL: EIGENSCHAFT_START, IN: EIGENSCHAFT_START, CH: EIGENSCHAFT_START,
      FF: EIGENSCHAFT_START, GE: EIGENSCHAFT_START, KO: EIGENSCHAFT_START, KK: EIGENSCHAFT_START,
    },
    fertigkeiten: {},
    kampftechniken: {},
    vorteile: [],
    nachteile: [],
    sonderfertigkeiten: [],
    zauber: {},
    liturgien: {},
    traditionMagisch: null,
    traditionKarmal: null,
    energienKauf: { le: 0, ae: 0, ke: 0 },
    ausruestung: [],
    geld: { dukaten: 0, silbertaler: 0, heller: 0, kreuzer: 0 },
    notizen: '',
  };
}

/** Eig1..Eig8 aus app/data/eigenschaften.json, in der Reihenfolge von EIGENSCHAFTEN (derived.ts). */
const EIG_ID_ZU_NAME: Readonly<Record<string, EigenschaftName>> = Object.freeze({
  Eig1: 'MU', Eig2: 'KL', Eig3: 'IN', Eig4: 'CH', Eig5: 'FF', Eig6: 'GE', Eig7: 'KO', Eig8: 'KK',
});

type EwPaar = readonly [string, number];

function istEwPaar(wert: unknown): wert is EwPaar {
  return Array.isArray(wert) && wert.length === 2
    && typeof wert[0] === 'string' && typeof wert[1] === 'number';
}

/**
 * Decodiert `spezies.EW`. Ein flaches Paar (z. B. `["Eig3", 1]`) ist unbedingt. Ein
 * verschachteltes Array von Paaren (z. B. `[["Eig1", -1], ["Eig8", -1]]`) ist eine
 * Spieler-WAHL von genau einer Option; `abzug` benennt die gewählte Eigenschaft. Eine
 * ungelöste Wahl (abzug null, oder nicht unter den angebotenen Optionen) trägt nichts bei.
 */
export function speziesModifikatoren(
  ew: unknown, abzug: EigenschaftName | null,
): Partial<Record<EigenschaftName, number>> {
  const ergebnis: Partial<Record<EigenschaftName, number>> = {};
  if (!Array.isArray(ew)) return ergebnis;

  const anwenden = (paar: EwPaar): void => {
    const name = EIG_ID_ZU_NAME[paar[0]];
    if (name === undefined) return;
    ergebnis[name] = (ergebnis[name] ?? 0) + paar[1];
  };

  const eintraege: readonly unknown[] = ew;
  for (const eintrag of eintraege) {
    if (istEwPaar(eintrag)) {
      anwenden(eintrag);
      continue;
    }
    if (!Array.isArray(eintrag)) continue;
    // Verschachtelt: eine Wahlgruppe von Paaren. Nur die zu `abzug` passende Option zählt.
    if (abzug === null) continue;
    const optionen: readonly unknown[] = eintrag;
    for (const option of optionen) {
      if (istEwPaar(option) && EIG_ID_ZU_NAME[option[0]] === abzug) {
        anwenden(option);
        break;
      }
    }
  }
  return ergebnis;
}

/**
 * Gekaufte Eigenschaften plus Spezies-Modifikatoren. NUR zur Anzeige — für
 * Erschaffungsgrenzen ausschließlich `held.eigenschaftenGekauft` prüfen (Ruling R13).
 */
export function eigenschaftenFinal(held: Held, ew: unknown): Eigenschaften {
  const m = speziesModifikatoren(ew, held.speziesAbzug);
  const g = held.eigenschaftenGekauft;
  return {
    MU: g.MU + (m.MU ?? 0),
    KL: g.KL + (m.KL ?? 0),
    IN: g.IN + (m.IN ?? 0),
    CH: g.CH + (m.CH ?? 0),
    FF: g.FF + (m.FF ?? 0),
    GE: g.GE + (m.GE ?? 0),
    KO: g.KO + (m.KO ?? 0),
    KK: g.KK + (m.KK ?? 0),
  };
}

export function kampftechnikWert(held: Held, name: string): number {
  return held.kampftechniken[name] ?? KAMPFTECHNIK_START;
}

export function fertigkeitWert(held: Held, id: string): number {
  return held.fertigkeiten[id] ?? FERTIGKEIT_START;
}
