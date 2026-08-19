/**
 * Charakter-Zustand mit Undo/Redo und Autosave.
 *
 * Bleibt strikt browserkompatibel (nur `localStorage`/`JSON`, kein `node:*`). `localStorage`
 * kann fehlen oder beim Zugriff werfen (privater Modus, deaktivierte Speicherung, volles
 * Kontingent) — jede Interaktion damit ist defensiv: nie eine Exception nach außen tragen,
 * bei Fehlern einfach in-memory weiterarbeiten (der `Store` hält seinen Zustand ohnehin
 * unabhängig davon im Speicher; Autosave ist rein "best effort").
 */
import { leererHeld } from '../core/character.ts';
import type { Held } from '../core/character.ts';
import { EIGENSCHAFTEN } from '../core/derived.ts';
import type { EigenschaftName } from '../core/types.ts';

export const SPEICHER_SCHLUESSEL = 'dsa5-heldengenerator:held';

const AUTOSAVE_VERZOEGERUNG_MS = 300;
const VERLAUF_MAX = 50;

export type Store = {
  held(): Held;
  /** Immutable Änderung: berechnet den neuen Helden aus dem alten, legt Undo-Punkt an. */
  setze(aenderung: (held: Held) => Held): void;
  /** Ersetzt den gesamten Helden (z. B. nach einem Import), legt ebenfalls Undo-Punkt an. */
  ersetze(held: Held): void;
  rueckgaengig(): boolean;
  wiederholen(): boolean;
  kannRueckgaengig(): boolean;
  kannWiederholen(): boolean;
  /** Ruft `hoerer` bei jeder Zustandsänderung auf; die Rückgabe meldet wieder ab. */
  abonniere(hoerer: (held: Held) => void): () => void;
};

export function erzeugeStore(start: Held = leererHeld()): Store {
  let aktuell = start;
  const verlauf: Held[] = [];
  const zukunft: Held[] = [];
  const hoerer = new Set<(held: Held) => void>();
  let autosaveTimer: ReturnType<typeof setTimeout> | undefined;

  const benachrichtige = (): void => {
    for (const einHoerer of hoerer) einHoerer(aktuell);
  };

  const planeAutosave = (): void => {
    if (autosaveTimer !== undefined) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      autosaveTimer = undefined;
      speichere(aktuell);
    }, AUTOSAVE_VERZOEGERUNG_MS);
  };

  const legeUndoPunktAn = (): void => {
    verlauf.push(aktuell);
    if (verlauf.length > VERLAUF_MAX) verlauf.shift();
    zukunft.length = 0;
  };

  const uebernimm = (neu: Held): void => {
    aktuell = neu;
    benachrichtige();
    planeAutosave();
  };

  return {
    held: () => aktuell,

    setze(aenderung) {
      legeUndoPunktAn();
      uebernimm(aenderung(aktuell));
    },

    ersetze(held) {
      legeUndoPunktAn();
      uebernimm(held);
    },

    rueckgaengig() {
      const voriger = verlauf.pop();
      if (voriger === undefined) return false;
      zukunft.push(aktuell);
      uebernimm(voriger);
      return true;
    },

    wiederholen() {
      const naechster = zukunft.pop();
      if (naechster === undefined) return false;
      verlauf.push(aktuell);
      if (verlauf.length > VERLAUF_MAX) verlauf.shift();
      uebernimm(naechster);
      return true;
    },

    kannRueckgaengig: () => verlauf.length > 0,
    kannWiederholen: () => zukunft.length > 0,

    abonniere(einHoerer) {
      hoerer.add(einHoerer);
      return () => { hoerer.delete(einHoerer); };
    },
  };
}

/**
 * Liefert `localStorage`, falls es existiert und zugreifbar ist — sonst `null`.
 * `typeof localStorage` wirft nie, selbst wenn der Bezeichner nirgends deklariert ist (z. B.
 * unter Node/Playwright ohne Browser); ein Zugriff kann aber dennoch werfen (privater Safari-
 * Modus u. Ä. lassen bereits das Lesen des Getters scheitern), daher zusätzlich try/catch.
 */
function holeSpeicher(): Storage | null {
  try {
    if (typeof localStorage === 'undefined' || localStorage === null) return null;
    return localStorage;
  } catch {
    return null;
  }
}

function istVollstaendigeEigenschaften(wert: unknown): wert is Record<EigenschaftName, number> {
  if (typeof wert !== 'object' || wert === null || Array.isArray(wert)) return false;
  const kandidat = wert as Record<string, unknown>;
  return EIGENSCHAFTEN.every((name) => Number.isFinite(kandidat[name]));
}

/**
 * Prüft nur, was für einen sicheren Wiedereinstieg unerlässlich ist — allen voran, dass
 * `eigenschaftenGekauft` VOLLSTÄNDIG ist (alle acht Eigenschaften, jeweils eine endliche
 * Zahl). Das ist kein Zufall: `pruefeEigenschaften` (limits.ts, Ruling R13) wurde genau
 * dafür gehärtet, ein partielles Eigenschaften-Objekt zu erkennen statt es stillschweigend
 * als 0/NaN durchzureichen — ein korrupter/unvollständiger Autosave-Fund ist exakt die
 * Quelle, vor der das schützen soll. Diese Funktion ist bewusst keine vollständige
 * Held-Validierung (nicht jedes Feld wird geprüft); sie verhindert nur, dass offensichtlich
 * kaputte oder wesensfremde JSON-Werte (`null`, ein Array, ein fehlendes/kaputtes
 * `eigenschaftenGekauft`) als gültiger `Held` durchgehen.
 */
function istGueltigerHeld(wert: unknown): wert is Held {
  if (typeof wert !== 'object' || wert === null || Array.isArray(wert)) return false;
  const kandidat = wert as Record<string, unknown>;
  return kandidat['schemaVersion'] === 1
    && typeof kandidat['erfahrungsgrad'] === 'string'
    && istVollstaendigeEigenschaften(kandidat['eigenschaftenGekauft']);
}

/** Lädt den gespeicherten Helden. Liefert `null` bei jedem Fehler statt zu werfen. */
export function ladeGespeicherten(): Held | null {
  const speicher = holeSpeicher();
  if (speicher === null) return null;

  let roh: string | null;
  try {
    roh = speicher.getItem(SPEICHER_SCHLUESSEL);
  } catch {
    return null;
  }
  if (roh === null) return null;

  let geparst: unknown;
  try {
    geparst = JSON.parse(roh);
  } catch {
    return null;
  }

  return istGueltigerHeld(geparst) ? geparst : null;
}

/** Speichert den Helden. Schlägt der Schreibzugriff fehl (z. B. Kontingent voll), wird das
 *  stillschweigend verworfen — die Anwendung läuft ohne Persistenz einfach weiter. */
export function speichere(held: Held): void {
  const speicher = holeSpeicher();
  if (speicher === null) return;
  try {
    speicher.setItem(SPEICHER_SCHLUESSEL, JSON.stringify(held));
  } catch {
    // absichtlich verschluckt, siehe Dokumentationskommentar oben
  }
}

export function loescheSpeicher(): void {
  const speicher = holeSpeicher();
  if (speicher === null) return;
  try {
    speicher.removeItem(SPEICHER_SCHLUESSEL);
  } catch {
    // absichtlich verschluckt, siehe Dokumentationskommentar oben
  }
}
