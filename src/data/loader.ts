/**
 * Lädt die generierten Datensätze (`app/data/*.json`) im Browser nach.
 *
 * Bleibt strikt browserkompatibel (nur `fetch`/`JSON`, kein `node:*`) — die Site wird auch
 * unter einem GitHub-Pages-Unterpfad ausgeliefert (`https://user.github.io/dsa5-heldengenerator/`),
 * daher wird IMMER relativ zum aktuellen Dokument geladen (`./data/<name>.json`), niemals
 * absolut (`/data/...`) — ein absoluter Pfad würde unter einem Unterpfad ins Leere laufen.
 */
import type { DatenIndex } from '../core/apkonto.ts';
import type {
  SpeziesEintrag, KulturEintrag, ProfessionEintrag, TalentEintrag, KampftechnikEintrag,
  EigenheitEintrag, ZauberLiturgieEintrag,
} from '../core/apkonto.ts';

export type DatensatzName =
  | 'talente' | 'spezies' | 'kulturen' | 'professionen' | 'vorteile' | 'nachteile'
  | 'kampftechniken' | 'zauber' | 'liturgien' | 'sprachen' | 'traditionen' | 'eigenschaften'
  | 'sf_allgemein' | 'sf_kampf' | 'sf_magisch' | 'sf_karmal' | 'ausruestung';

export type DatensatzZeile = Record<string, unknown>;

/** Standard-Basispfad: relativ zum aktuellen Dokument, nie absolut (siehe Modul-Kommentar). */
const STANDARD_BASISPFAD = './data/';

let basisPfad: string = STANDARD_BASISPFAD;

/**
 * Überschreibt den Basispfad, unter dem Datensätze gesucht werden (Standard: `./data/`).
 * Für Tests (Stub-`fetch` gegen eine feste URL-Vorlage) oder Seiten, die nicht auf oberster
 * Ebene liegen. Ein abschließender `/` wird bei Bedarf ergänzt.
 */
export function setzeBasisPfad(pfad: string): void {
  basisPfad = pfad.endsWith('/') ? pfad : `${pfad}/`;
}

const geladen = new Map<DatensatzName, ReadonlyArray<DatensatzZeile>>();
const unterwegs = new Map<DatensatzName, Promise<ReadonlyArray<DatensatzZeile>>>();

function istUnknownArray(wert: unknown): wert is ReadonlyArray<unknown> {
  return Array.isArray(wert);
}

function istZeile(wert: unknown): wert is DatensatzZeile {
  return typeof wert === 'object' && wert !== null && !Array.isArray(wert);
}

function beschreibeFehler(fehler: unknown): string {
  return fehler instanceof Error ? fehler.message : String(fehler);
}

async function ladeUndValidiere(name: DatensatzName): Promise<ReadonlyArray<DatensatzZeile>> {
  const url = `${basisPfad}${name}.json`;

  let antwort: Response;
  try {
    antwort = await fetch(url);
  } catch (fehler) {
    throw new Error(
      `Datensatz "${name}" konnte nicht geladen werden (Netzwerkfehler bei ${url}): ${beschreibeFehler(fehler)}`,
    );
  }

  if (!antwort.ok) {
    throw new Error(
      `Datensatz "${name}" konnte nicht geladen werden: ${url} antwortete mit Status ${antwort.status}.`,
    );
  }

  let rohdaten: unknown;
  try {
    rohdaten = await antwort.json();
  } catch (fehler) {
    throw new Error(
      `Datensatz "${name}" enthält kein gültiges JSON (${url}): ${beschreibeFehler(fehler)}`,
    );
  }

  if (!istUnknownArray(rohdaten) || !rohdaten.every(istZeile)) {
    throw new Error(
      `Datensatz "${name}" hat ein unerwartetes Format (${url}): erwartet wurde ein Array von Objekten.`,
    );
  }

  return rohdaten;
}

/**
 * Lädt einen Datensatz per Name, träge (nur bei Bedarf) und pro Kategorie. Ergebnisse werden
 * nach dem ersten erfolgreichen Laden zwischengespeichert; parallele Aufrufe für denselben
 * Namen teilen sich EINE laufende Anfrage statt mehrfach zu feuern. `ausruestung` ist groß
 * (>3000 Zeilen) — es wird nie implizit mitgeladen, nur wenn explizit angefordert.
 */
export function ladeDatensatz(name: DatensatzName): Promise<ReadonlyArray<DatensatzZeile>> {
  const vorhanden = geladen.get(name);
  if (vorhanden !== undefined) return Promise.resolve(vorhanden);

  const laufend = unterwegs.get(name);
  if (laufend !== undefined) return laufend;

  const anfrage = ladeUndValidiere(name)
    .then((zeilen) => {
      geladen.set(name, zeilen);
      unterwegs.delete(name);
      return zeilen;
    })
    .catch((fehler: unknown) => {
      unterwegs.delete(name);
      throw fehler;
    });

  unterwegs.set(name, anfrage);
  return anfrage;
}

/** Baut eine `ReadonlyMap<string, T>` aus einem Datensatz, indiziert über `schluesselFeld`. */
function indexiere<T>(
  zeilen: ReadonlyArray<DatensatzZeile>, schluesselFeld: string,
): ReadonlyMap<string, T> {
  const karte = new Map<string, T>();
  for (const zeile of zeilen) {
    const schluessel = zeile[schluesselFeld];
    if (typeof schluessel === 'string' && schluessel !== '') {
      karte.set(schluessel, zeile as unknown as T);
    }
  }
  return karte;
}

/**
 * Baut den `DatenIndex` (siehe `src/core/apkonto.ts`), der die AP-Konto-Berechnung mit
 * Nachschlagetabellen versorgt. Lädt genau die neun dafür benötigten Kategorien — weder die
 * Sonderfertigkeiten- noch die Ausrüstungs-Datensätze werden dafür gebraucht, sie bleiben
 * ungeladen, bis sie eigenständig über `ladeDatensatz` angefordert werden.
 *
 * `professionen` trägt (anders als spezies/kulturen/talente/vorteile/nachteile/zauber/liturgien)
 * KEIN eigenes `ID`-Feld — `ProfessionGetInfo` kennt dafür schlicht keinen `pInfoID`-Schlüssel
 * (siehe `tools/build-data.ts`). Indiziert wird daher über `Name divers`, ebenso wie
 * Kampftechniken (ohne `ID`-Feld) bereits nach Namen indiziert werden (`apkonto.ts`-Kommentar).
 */
export async function baueDatenIndex(): Promise<DatenIndex> {
  const [spezies, kulturen, professionen, talente, kampftechniken, vorteile, nachteile, zauber, liturgien] =
    await Promise.all([
      ladeDatensatz('spezies'),
      ladeDatensatz('kulturen'),
      ladeDatensatz('professionen'),
      ladeDatensatz('talente'),
      ladeDatensatz('kampftechniken'),
      ladeDatensatz('vorteile'),
      ladeDatensatz('nachteile'),
      ladeDatensatz('zauber'),
      ladeDatensatz('liturgien'),
    ]);

  return {
    spezies: indexiere<SpeziesEintrag>(spezies, 'ID'),
    kulturen: indexiere<KulturEintrag>(kulturen, 'ID'),
    professionen: indexiere<ProfessionEintrag>(professionen, 'Name divers'),
    talente: indexiere<TalentEintrag>(talente, 'ID'),
    kampftechniken: indexiere<KampftechnikEintrag>(kampftechniken, 'Name'),
    vorteile: indexiere<EigenheitEintrag>(vorteile, 'ID'),
    nachteile: indexiere<EigenheitEintrag>(nachteile, 'ID'),
    zauber: indexiere<ZauberLiturgieEintrag>(zauber, 'ID'),
    liturgien: indexiere<ZauberLiturgieEintrag>(liturgien, 'ID'),
  };
}
