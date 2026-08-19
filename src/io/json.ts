/**
 * Natives JSON-Format für den Heldenexport/-import (Plan 3). Rein browserkompatibel: keine
 * `node:*`-Importe, nur Web-Standard-APIs (`JSON`, `Date`).
 *
 * Sicherheitsprinzip: `importiereJSON` parst nutzerbereitgestellte Dateien und darf ihnen
 * NIEMALS trauen. Jedes Feld wird explizit gegen sein erwartetes Format geprüft; das Ergebnis
 * wird als komplett neues Objekt aufgebaut, Feld für Feld — nie via `Object.assign(ziel, roh)`
 * oder `{...roh}` auf ungeprüften Eingabedaten (beides würde bei einem eingeschleusten
 * `"__proto__"`-Schlüssel `Object.prototype` verunreinigen können, weil `Object.assign`
 * `[[Set]]` verwendet, das die Prototypkette hochläuft und den `__proto__`-Setter auslöst;
 * ein simpler `raw['feld']`-Zugriff plus manuell aufgebautes Ziel-Objekt tut das nicht). Ein
 * unbekannter Schlüssel (inklusive `__proto__`) wird dadurch automatisch verworfen statt
 * übernommen — es gibt keinen Code-Pfad, der ihn je liest.
 */
import { leererHeld } from '../core/character.ts';
import type { Held, GewaehlteEigenheit } from '../core/character.ts';
import { EIGENSCHAFTEN } from '../core/derived.ts';
import type { EigenschaftName } from '../core/types.ts';

export const JSON_SCHEMA_VERSION = 1 as const;

export type ImportErgebnis = { ok: true; held: Held } | { ok: false; fehler: string[] };

const APP_NAME = 'dsa5-heldengenerator';

// --- Export ---------------------------------------------------------------------------------

function sortierterRecord(rec: Readonly<Record<string, number>>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of Object.keys(rec).sort()) out[key] = rec[key] as number;
  return out;
}

function kopiereEigenheit(e: GewaehlteEigenheit): GewaehlteEigenheit {
  const out: GewaehlteEigenheit = { id: e.id };
  if (e.stufe !== undefined) out.stufe = e.stufe;
  if (e.erweiterung !== undefined) out.erweiterung = e.erweiterung;
  return out;
}

/**
 * Serialisiert `held` als eingerücktes JSON mit stabiler, fester Schlüsselreihenfolge
 * (unabhängig von der internen Einfüge-Reihenfolge der Objekte). Enthält einen `_meta`-Block
 * (App-Name, Export-Zeitstempel); dieser wird beim Import ignoriert und beeinflusst die
 * Round-Trip-Gleichheit des `Held` nicht.
 */
export function exportiereJSON(held: Held): string {
  const out = {
    schemaVersion: held.schemaVersion,
    meta: {
      name: held.meta.name,
      familie: held.meta.familie,
      geburtsort: held.meta.geburtsort,
      geburtsdatum: held.meta.geburtsdatum,
      alter: held.meta.alter,
      geschlecht: held.meta.geschlecht,
      groesse: held.meta.groesse,
      gewicht: held.meta.gewicht,
      haarfarbe: held.meta.haarfarbe,
      augenfarbe: held.meta.augenfarbe,
      titel: held.meta.titel,
      sozialstatus: held.meta.sozialstatus,
      charakteristika: held.meta.charakteristika,
      sonstiges: held.meta.sonstiges,
    },
    erfahrungsgrad: held.erfahrungsgrad,
    spezies: held.spezies,
    speziesAbzug: held.speziesAbzug,
    kultur: held.kultur,
    profession: held.profession,
    eigenschaftenGekauft: {
      MU: held.eigenschaftenGekauft.MU,
      KL: held.eigenschaftenGekauft.KL,
      IN: held.eigenschaftenGekauft.IN,
      CH: held.eigenschaftenGekauft.CH,
      FF: held.eigenschaftenGekauft.FF,
      GE: held.eigenschaftenGekauft.GE,
      KO: held.eigenschaftenGekauft.KO,
      KK: held.eigenschaftenGekauft.KK,
    },
    fertigkeiten: sortierterRecord(held.fertigkeiten),
    kampftechniken: sortierterRecord(held.kampftechniken),
    vorteile: held.vorteile.map(kopiereEigenheit),
    nachteile: held.nachteile.map(kopiereEigenheit),
    sonderfertigkeiten: held.sonderfertigkeiten.map(kopiereEigenheit),
    zauber: sortierterRecord(held.zauber),
    liturgien: sortierterRecord(held.liturgien),
    traditionMagisch: held.traditionMagisch,
    traditionKarmal: held.traditionKarmal,
    energienKauf: {
      le: held.energienKauf.le,
      ae: held.energienKauf.ae,
      ke: held.energienKauf.ke,
    },
    ausruestung: held.ausruestung.map((a) => ({ id: a.id, anzahl: a.anzahl })),
    geld: {
      dukaten: held.geld.dukaten,
      silbertaler: held.geld.silbertaler,
      heller: held.geld.heller,
      kreuzer: held.geld.kreuzer,
    },
    notizen: held.notizen,
    _meta: { app: APP_NAME, exportiertAm: new Date().toISOString() },
  };
  return JSON.stringify(out, null, 2);
}

// --- Import: Type Guards ----------------------------------------------------------------------

function istPlainObject(wert: unknown): wert is Record<string, unknown> {
  return typeof wert === 'object' && wert !== null && !Array.isArray(wert);
}

function istString(wert: unknown): wert is string {
  return typeof wert === 'string';
}

function istEndlicheZahl(wert: unknown): wert is number {
  return typeof wert === 'number' && Number.isFinite(wert);
}

function istStringOderNull(wert: unknown): wert is string | null {
  return wert === null || typeof wert === 'string';
}

const EIGENSCHAFT_NAMEN: ReadonlySet<string> = new Set(EIGENSCHAFTEN);

function istEigenschaftName(wert: unknown): wert is EigenschaftName {
  return typeof wert === 'string' && EIGENSCHAFT_NAMEN.has(wert);
}

/** Sammelt Fehler statt zu werfen; jeder Aufrufer bekommt eine Liste, nicht nur den ersten Treffer. */
class Fehlersammlung {
  readonly fehler: string[] = [];
  melde(text: string): void {
    this.fehler.push(text);
  }
}

/** Liest ein optionales `string`-Feld; fehlt es, gilt `basis`. */
function leseString(
  raw: Readonly<Record<string, unknown>>, feld: string, fehler: Fehlersammlung, basis: string,
): string {
  if (!(feld in raw)) return basis;
  const wert = raw[feld];
  if (!istString(wert)) {
    fehler.melde(`${feld} muss ein Text sein.`);
    return basis;
  }
  return wert;
}

/** Liest ein optionales `string | null`-Feld; fehlt es, gilt `basis`. */
function leseStringOderNull(
  raw: Readonly<Record<string, unknown>>, feld: string, fehler: Fehlersammlung, basis: string | null,
): string | null {
  if (!(feld in raw)) return basis;
  const wert = raw[feld];
  if (!istStringOderNull(wert)) {
    fehler.melde(`${feld} muss Text oder null sein.`);
    return basis;
  }
  return wert;
}

/**
 * `eigenschaftenGekauft`: erwartet ein Objekt mit genau den acht Eigenschaftswerten als
 * endliche Zahlen. Fehlt das Feld komplett, liefert der Aufrufer den `leererHeld()`-Default;
 * ist es vorhanden, aber strukturell falsch (z. B. ein String), zählt das als Importfehler.
 */
function leseEigenschaftenGekauft(
  wert: unknown, fehler: Fehlersammlung,
): Record<EigenschaftName, number> | null {
  if (!istPlainObject(wert)) {
    fehler.melde('eigenschaftenGekauft muss ein Objekt mit den acht Eigenschaftswerten sein.');
    return null;
  }
  const out: Partial<Record<EigenschaftName, number>> = {};
  for (const name of EIGENSCHAFTEN) {
    const einzelwert = wert[name];
    if (!istEndlicheZahl(einzelwert)) {
      fehler.melde(`eigenschaftenGekauft.${name} fehlt oder ist keine gültige Zahl.`);
      continue;
    }
    out[name] = einzelwert;
  }
  if (fehler.fehler.length > 0) return null;
  return out as Record<EigenschaftName, number>;
}

/** `fertigkeiten`/`kampftechniken`/`zauber`/`liturgien`: beliebige Textschlüssel, Zahlenwerte. */
function leseZahlenRecord(
  wert: unknown, feldname: string, fehler: Fehlersammlung,
): Record<string, number> | null {
  if (!istPlainObject(wert)) {
    fehler.melde(`${feldname} muss ein Objekt mit numerischen Werten sein.`);
    return null;
  }
  const out: Record<string, number> = {};
  for (const [key, einzelwert] of Object.entries(wert)) {
    if (!istEndlicheZahl(einzelwert)) {
      fehler.melde(`${feldname}.${key} ist keine gültige Zahl.`);
      continue;
    }
    out[key] = einzelwert;
  }
  if (fehler.fehler.length > 0) return null;
  return out;
}

function leseGewaehlteEigenheit(
  wert: unknown, feldname: string, index: number, fehler: Fehlersammlung,
): GewaehlteEigenheit | null {
  if (!istPlainObject(wert)) {
    fehler.melde(`${feldname}[${index}] muss ein Objekt sein.`);
    return null;
  }
  const id = wert['id'];
  if (!istString(id) || id.length === 0) {
    fehler.melde(`${feldname}[${index}].id fehlt oder ist kein Text.`);
    return null;
  }
  const out: GewaehlteEigenheit = { id };
  if ('stufe' in wert && wert['stufe'] !== undefined) {
    if (!istEndlicheZahl(wert['stufe'])) {
      fehler.melde(`${feldname}[${index}].stufe ist keine gültige Zahl.`);
      return null;
    }
    out.stufe = wert['stufe'];
  }
  if ('erweiterung' in wert && wert['erweiterung'] !== undefined) {
    if (!istString(wert['erweiterung'])) {
      fehler.melde(`${feldname}[${index}].erweiterung ist kein Text.`);
      return null;
    }
    out.erweiterung = wert['erweiterung'];
  }
  return out;
}

function leseEigenheitenArray(
  wert: unknown, feldname: string, fehler: Fehlersammlung,
): GewaehlteEigenheit[] | null {
  if (!Array.isArray(wert)) {
    fehler.melde(`${feldname} muss eine Liste sein.`);
    return null;
  }
  const out: GewaehlteEigenheit[] = [];
  wert.forEach((eintrag, index) => {
    const gelesen = leseGewaehlteEigenheit(eintrag, feldname, index, fehler);
    if (gelesen !== null) out.push(gelesen);
  });
  if (fehler.fehler.length > 0) return null;
  return out;
}

function leseAusruestung(
  wert: unknown, fehler: Fehlersammlung,
): Array<{ id: string; anzahl: number }> | null {
  if (!Array.isArray(wert)) {
    fehler.melde('ausruestung muss eine Liste sein.');
    return null;
  }
  const out: Array<{ id: string; anzahl: number }> = [];
  wert.forEach((eintrag, index) => {
    if (!istPlainObject(eintrag)) {
      fehler.melde(`ausruestung[${index}] muss ein Objekt sein.`);
      return;
    }
    const id = eintrag['id'];
    const anzahl = eintrag['anzahl'];
    if (!istString(id) || id.length === 0) {
      fehler.melde(`ausruestung[${index}].id fehlt oder ist kein Text.`);
      return;
    }
    if (!istEndlicheZahl(anzahl)) {
      fehler.melde(`ausruestung[${index}].anzahl ist keine gültige Zahl.`);
      return;
    }
    out.push({ id, anzahl });
  });
  if (fehler.fehler.length > 0) return null;
  return out;
}

function leseMeta(wert: unknown, fehler: Fehlersammlung): Held['meta'] | null {
  if (!istPlainObject(wert)) {
    fehler.melde('meta muss ein Objekt sein.');
    return null;
  }
  const felder = [
    'name', 'familie', 'geburtsort', 'geburtsdatum', 'alter', 'geschlecht', 'groesse',
    'gewicht', 'haarfarbe', 'augenfarbe', 'titel', 'sozialstatus', 'charakteristika', 'sonstiges',
  ] as const;
  const out: Partial<Held['meta']> = {};
  for (const feld of felder) {
    const einzelwert = wert[feld];
    if (!istString(einzelwert)) {
      fehler.melde(`meta.${feld} fehlt oder ist kein Text.`);
      continue;
    }
    out[feld] = einzelwert;
  }
  if (fehler.fehler.length > 0) return null;
  return out as Held['meta'];
}

function leseGeld(wert: unknown, fehler: Fehlersammlung): Held['geld'] | null {
  if (!istPlainObject(wert)) {
    fehler.melde('geld muss ein Objekt sein.');
    return null;
  }
  const felder = ['dukaten', 'silbertaler', 'heller', 'kreuzer'] as const;
  const out: Partial<Held['geld']> = {};
  for (const feld of felder) {
    const einzelwert = wert[feld];
    if (!istEndlicheZahl(einzelwert)) {
      fehler.melde(`geld.${feld} fehlt oder ist keine gültige Zahl.`);
      continue;
    }
    out[feld] = einzelwert;
  }
  if (fehler.fehler.length > 0) return null;
  return out as Held['geld'];
}

function leseEnergienKauf(wert: unknown, fehler: Fehlersammlung): Held['energienKauf'] | null {
  if (!istPlainObject(wert)) {
    fehler.melde('energienKauf muss ein Objekt sein.');
    return null;
  }
  const felder = ['le', 'ae', 'ke'] as const;
  const out: Partial<Held['energienKauf']> = {};
  for (const feld of felder) {
    const einzelwert = wert[feld];
    if (!istEndlicheZahl(einzelwert)) {
      fehler.melde(`energienKauf.${feld} fehlt oder ist keine gültige Zahl.`);
      continue;
    }
    out[feld] = einzelwert;
  }
  if (fehler.fehler.length > 0) return null;
  return out as Held['energienKauf'];
}

/**
 * Parst und validiert eine JSON-Heldendatei. Vertraut der Eingabe an keiner Stelle: fehlende
 * optionale Abschnitte fallen auf `leererHeld()`-Defaults zurück, strukturell falsche
 * Abschnitte (Typfehler, falsche Form) lassen den gesamten Import fehlschlagen — es gibt
 * kein Teil-Ergebnis mit stillschweigend geflickten Feldern. Unbekannte Zusatzschlüssel
 * (inklusive eines eingeschleusten `"__proto__"`) werden verworfen, nie übernommen: jedes
 * Feld wird explizit ausgelesen und in ein frisches Objekt kopiert, s. Modul-Kommentar oben.
 */
export function importiereJSON(text: string): ImportErgebnis {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    const nachricht = e instanceof Error ? e.message : String(e);
    return { ok: false, fehler: [`Ungültiges JSON: ${nachricht}`] };
  }

  if (!istPlainObject(parsed)) {
    return { ok: false, fehler: ['Die Datei enthält kein JSON-Objekt.'] };
  }
  const raw = parsed;

  const schemaVersion = raw['schemaVersion'];
  if (schemaVersion !== JSON_SCHEMA_VERSION) {
    return {
      ok: false,
      fehler: [
        `Unbekannte oder fehlende schemaVersion (erwartet: ${JSON_SCHEMA_VERSION}, ` +
        `erhalten: ${JSON.stringify(schemaVersion)}).`,
      ],
    };
  }

  const basis = leererHeld();
  const fehler = new Fehlersammlung();

  const meta = 'meta' in raw ? leseMeta(raw['meta'], fehler) : basis.meta;

  const erfahrungsgrad = leseString(raw, 'erfahrungsgrad', fehler, basis.erfahrungsgrad);

  const spezies = leseStringOderNull(raw, 'spezies', fehler, basis.spezies);

  let speziesAbzug: EigenschaftName | null = basis.speziesAbzug;
  if ('speziesAbzug' in raw) {
    const wert = raw['speziesAbzug'];
    if (wert === null || istEigenschaftName(wert)) {
      speziesAbzug = wert;
    } else {
      fehler.melde('speziesAbzug muss eine gültige Eigenschaft oder null sein.');
    }
  }

  const kultur = leseStringOderNull(raw, 'kultur', fehler, basis.kultur);

  const profession = leseStringOderNull(raw, 'profession', fehler, basis.profession);

  const eigenschaftenGekauft = 'eigenschaftenGekauft' in raw
    ? leseEigenschaftenGekauft(raw['eigenschaftenGekauft'], fehler)
    : basis.eigenschaftenGekauft;

  const fertigkeiten = 'fertigkeiten' in raw
    ? leseZahlenRecord(raw['fertigkeiten'], 'fertigkeiten', fehler)
    : basis.fertigkeiten;

  const kampftechniken = 'kampftechniken' in raw
    ? leseZahlenRecord(raw['kampftechniken'], 'kampftechniken', fehler)
    : basis.kampftechniken;

  const vorteile = 'vorteile' in raw
    ? leseEigenheitenArray(raw['vorteile'], 'vorteile', fehler)
    : basis.vorteile;

  const nachteile = 'nachteile' in raw
    ? leseEigenheitenArray(raw['nachteile'], 'nachteile', fehler)
    : basis.nachteile;

  const sonderfertigkeiten = 'sonderfertigkeiten' in raw
    ? leseEigenheitenArray(raw['sonderfertigkeiten'], 'sonderfertigkeiten', fehler)
    : basis.sonderfertigkeiten;

  const zauber = 'zauber' in raw
    ? leseZahlenRecord(raw['zauber'], 'zauber', fehler)
    : basis.zauber;

  const liturgien = 'liturgien' in raw
    ? leseZahlenRecord(raw['liturgien'], 'liturgien', fehler)
    : basis.liturgien;

  const traditionMagisch = leseStringOderNull(raw, 'traditionMagisch', fehler, basis.traditionMagisch);

  const traditionKarmal = leseStringOderNull(raw, 'traditionKarmal', fehler, basis.traditionKarmal);

  const energienKauf = 'energienKauf' in raw
    ? leseEnergienKauf(raw['energienKauf'], fehler)
    : basis.energienKauf;

  const ausruestung = 'ausruestung' in raw
    ? leseAusruestung(raw['ausruestung'], fehler)
    : basis.ausruestung;

  const geld = 'geld' in raw ? leseGeld(raw['geld'], fehler) : basis.geld;

  const notizen = leseString(raw, 'notizen', fehler, basis.notizen);

  if (fehler.fehler.length > 0) return { ok: false, fehler: fehler.fehler };

  // Nach der Fehlerprüfung oben sind alle folgenden Werte non-null (jeder Fehlerfall hat
  // `fehler.melde(...)` aufgerufen, was den frühen Return oben auslöst). Die Zusicherungen
  // sind daher sicher; die Read-Funktionen geben `| null` nur zurück, um Fehlerfälle
  // TypeScript-freundlich vor der obigen Sammelprüfung durchzureichen.
  const held: Held = {
    schemaVersion: JSON_SCHEMA_VERSION,
    meta: meta as Held['meta'],
    erfahrungsgrad,
    spezies,
    speziesAbzug,
    kultur,
    profession,
    eigenschaftenGekauft: eigenschaftenGekauft as Record<EigenschaftName, number>,
    fertigkeiten: fertigkeiten as Record<string, number>,
    kampftechniken: kampftechniken as Record<string, number>,
    vorteile: vorteile as GewaehlteEigenheit[],
    nachteile: nachteile as GewaehlteEigenheit[],
    sonderfertigkeiten: sonderfertigkeiten as GewaehlteEigenheit[],
    zauber: zauber as Record<string, number>,
    liturgien: liturgien as Record<string, number>,
    traditionMagisch,
    traditionKarmal,
    energienKauf: energienKauf as Held['energienKauf'],
    ausruestung: ausruestung as Array<{ id: string; anzahl: number }>,
    geld: geld as Held['geld'],
    notizen,
  };
  return { ok: true, held };
}
