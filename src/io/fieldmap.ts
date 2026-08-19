/**
 * Held ↔ offizielle PDF-Felder (Plan 3). Feldnamen gegen das reale Formular
 * `423187-Charakterbogen_V2_13_...pdf` verifiziert (siehe `readAcroFields`), nicht geraten.
 *
 * `DatenIndex` (aus apkonto.ts) trägt nur, was `apKonto()` für die AP-Rechnung braucht
 * (z. B. `EigenheitEintrag = { BasisKosten }`, ohne Anzeigenamen; `SpeziesEintrag` ohne `EW`).
 * Für Anzeigenamen und Spezies-Modifikatoren brauchen wir mehr von denselben Datensatz-
 * Einträgen. Statt `apkonto.ts` anzufassen (verboten) oder eigene Datenzugriffe an `daten`
 * vorbei zu bauen, erweitern wir hier lokal um optionale Felder (`& { readonly Name?: ... }`).
 * Das ist typsicher ohne `as`-Cast: jedes `SpeziesEintrag` erfüllt trivial auch
 * `SpeziesEintrag & { readonly EW?: unknown }`, weil das Zusatzfeld optional ist. Ein Aufrufer,
 * der den echten (reicheren) Datensatz in die `ReadonlyMap` einträgt — wie es die App beim
 * Laden von app/data/*.json ohnehin tut — bekommt die Zusatzfelder hier automatisch zu sehen.
 */
import type { Held, GewaehlteEigenheit } from '../core/character.ts';
import { leererHeld, eigenschaftenFinal, speziesModifikatoren } from '../core/character.ts';
import { EIGENSCHAFTEN, basiswerte, ausweichen, initiative, astralenergie, karmaenergie } from '../core/derived.ts';
import type { Grundwerte, EigenschaftName } from '../core/types.ts';
import { apKonto } from '../core/apkonto.ts';
import type {
  DatenIndex, SpeziesEintrag, KulturEintrag, ProfessionEintrag, EigenheitEintrag,
  ZauberLiturgieEintrag,
} from '../core/apkonto.ts';

// --- lokal erweiterte Sichten auf DatenIndex-Einträge (s. Modul-Kommentar) --------------------

type SpeziesEintragErweitert = SpeziesEintrag & {
  readonly EW?: unknown;
  readonly 'Name divers'?: string;
  readonly LE?: number;
  readonly SK?: number;
  readonly ZK?: number;
  readonly GS?: number;
};
type KulturEintragErweitert = KulturEintrag & { readonly 'Name Plural'?: string };
type EigenheitEintragErweitert = EigenheitEintrag & { readonly 'Name divers'?: string };
type ZauberLiturgieEintragErweitert = ZauberLiturgieEintrag & { readonly Name?: string };
type ProfessionEintragErweitert = ProfessionEintrag & {
  readonly LeitMagie?: string;
  readonly LeitKarma?: string;
};

const EIGENSCHAFT_NAMEN: ReadonlySet<string> = new Set(EIGENSCHAFTEN);
function istEigenschaftName(wert: string | undefined): wert is EigenschaftName {
  return wert !== undefined && EIGENSCHAFT_NAMEN.has(wert);
}

function istEndlicheZahl(wert: number | undefined): wert is number {
  return wert !== undefined && Number.isFinite(wert);
}

// --- kleine gemeinsame Helfer ------------------------------------------------------------------

/** Schreibt `wert` nach `feld`, aber nur, wenn `feld` im Ziel-PDF tatsächlich existiert. */
function setze(ziel: Map<string, string>, felder: ReadonlySet<string>, feld: string, wert: string): void {
  if (felder.has(feld)) ziel.set(feld, wert);
}

function setzeZahl(ziel: Map<string, string>, felder: ReadonlySet<string>, feld: string, wert: number): void {
  setze(ziel, felder, feld, String(Math.round(wert)));
}

/**
 * Findet die belegten Zeilennummern einer Feldfamilie mit festem Präfix (z. B. `Vorteil_1`,
 * `Vorteil_2`, … aber NICHT `Vorteil_Er_1`, weil "Er_1" keine reine Zifferfolge ist),
 * numerisch aufsteigend sortiert. Wird sowohl beim Export (gegen `felder`) als auch beim
 * Import (gegen die Schlüssel von `werte`) verwendet, damit ein abweichendes Formular mit
 * mehr/weniger Zeilen graceful degradiert statt eine feste Zahl anzunehmen.
 */
function nummerierteSlots(namen: Iterable<string>, praefix: string): number[] {
  const treffer: number[] = [];
  for (const name of namen) {
    if (!name.startsWith(praefix)) continue;
    const rest = name.slice(praefix.length);
    if (/^\d+$/.test(rest)) treffer.push(Number(rest));
  }
  return treffer.sort((a, b) => a - b);
}

/** Findet den Datensatz-Schlüssel (ID), dessen benanntes Anzeigefeld exakt `anzeige` ist. */
function ermittleIdVonName<T>(
  index: ReadonlyMap<string, T>, name: (eintrag: T) => string | undefined, anzeige: string,
): string | null {
  if (anzeige.length === 0) return null;
  for (const [id, eintrag] of index) {
    if (name(eintrag) === anzeige) return id;
  }
  return null;
}

// --- Talent-Nummern werden aus dem Datensatz generiert, nicht hartkodiert ---------------------

/**
 * `Talent_FW_<n>`: `<n>` ist die numerische Endung der Talent-ID (`Tal61` -> 61), nicht Teil
 * von `TalentEintrag` (das nur `SF`/`Aktivieren` trägt) — daher direkt aus den Schlüsseln von
 * `daten.talente` abgeleitet. Talente ohne numerische ID-Endung (sollte es laut Datensatz
 * nicht geben) werden übersprungen statt zu einer falschen Zeile zu führen.
 */
function talentNummern(daten: DatenIndex): Map<string, number> {
  const out = new Map<string, number>();
  for (const id of daten.talente.keys()) {
    const treffer = /^Tal(\d+)$/.exec(id);
    if (treffer === undefined || treffer === null) continue;
    const n = treffer[1];
    if (n === undefined) continue;
    out.set(id, Number(n));
  }
  return out;
}

// --- Grundwerte je Spezies (für die abgeleiteten Werte LE/SK/ZK/GS) ---------------------------

function grundwerteVon(eintrag: SpeziesEintragErweitert | undefined): Grundwerte | null {
  if (eintrag === undefined) return null;
  const { LE, SK, ZK, GS } = eintrag;
  if (!istEndlicheZahl(LE) || !istEndlicheZahl(SK) || !istEndlicheZahl(ZK) || !istEndlicheZahl(GS)) return null;
  return { le: LE, sk: SK, zk: ZK, gs: GS };
}

// === Held -> PDF-Felder ==========================================================================

export function heldZuFeldern(held: Held, daten: DatenIndex, felder: ReadonlySet<string>): Map<string, string> {
  const out = new Map<string, string>();

  // --- Identität -------------------------------------------------------------------------------
  setze(out, felder, 'Held_Name', held.meta.name);
  setze(out, felder, 'Held_Familie', held.meta.familie);
  setze(out, felder, 'Held_Geburtsort', held.meta.geburtsort);
  setze(out, felder, 'Held_Geburtsdatum', held.meta.geburtsdatum);
  setze(out, felder, 'Held_Alter', held.meta.alter);
  setze(out, felder, 'Held_Geschlecht', held.meta.geschlecht);
  setze(out, felder, 'Held_Groesse', held.meta.groesse);
  setze(out, felder, 'Held_Gewicht', held.meta.gewicht);
  setze(out, felder, 'Held_Haare', held.meta.haarfarbe);
  setze(out, felder, 'Held_Augen', held.meta.augenfarbe);
  setze(out, felder, 'Held_Titel', held.meta.titel);
  setze(out, felder, 'Held_Sozialstatus', held.meta.sozialstatus);
  setze(out, felder, 'Held_Charakteristika', held.meta.charakteristika);

  const speziesEintrag = held.spezies !== null
    ? (daten.spezies.get(held.spezies) as SpeziesEintragErweitert | undefined)
    : undefined;
  const kulturEintrag = held.kultur !== null
    ? (daten.kulturen.get(held.kultur) as KulturEintragErweitert | undefined)
    : undefined;
  const professionEintrag = held.profession !== null
    ? (daten.professionen.get(held.profession) as ProfessionEintragErweitert | undefined)
    : undefined;

  setze(out, felder, 'Held_Spezies_Anzeige', speziesEintrag?.['Name divers'] ?? held.spezies ?? '');
  setze(out, felder, 'Held_Kultur_Anzeige', kulturEintrag?.['Name Plural'] ?? held.kultur ?? '');
  // Professionen tragen im Datensatz keine eigene ID — `held.profession` IST bereits der
  // Anzeigename ("Name divers"), also 1:1 durchgereicht statt nachgeschlagen.
  setze(out, felder, 'Held_Profession_Anzeige', held.profession ?? '');

  // --- Eigenschaften (FINAL: gekauft + Spezies-Modifikator, weil das der Bogen anzeigt) --------
  const final = eigenschaftenFinal(held, speziesEintrag?.EW);
  for (const name of EIGENSCHAFTEN) setzeZahl(out, felder, `${name}_1`, final[name]);

  // --- AP-Konto ----------------------------------------------------------------------------------
  const konto = apKonto(held, daten);
  setzeZahl(out, felder, 'AP_gesamt', konto.budget);
  setzeZahl(out, felder, 'AP_ausgegeben', konto.ausgegeben);

  // --- Abgeleitete Werte ---------------------------------------------------------------------
  // Der Bogen berechnet diese Felder normalerweise selbst per eingebettetem Acrobat-JS; das
  // läuft in keinem Render-Pfad, der diese Bibliothek nutzt (Chrome/Preview/poppler/Druck), also
  // schreiben wir die fertig berechneten Werte explizit. AW/INI brauchen keine Spezies-
  // Grundwerte (nur Eigenschaften) und werden daher immer geschrieben; LE/SK/ZK/GS brauchen
  // `Grundwerte` aus dem Spezies-Datensatz und werden übersprungen, wenn die Spezies unbekannt
  // oder deren LE/SK/ZK/GS-Felder fehlen.
  setzeZahl(out, felder, 'AW_Wert_1', ausweichen(final));
  for (const feld of ['AW_Max_1', 'AW_Max_2']) setzeZahl(out, felder, feld, ausweichen(final));
  setzeZahl(out, felder, 'INI_Wert_1', initiative(final));
  for (const feld of ['INI_Max_1', 'INI_Max_2']) setzeZahl(out, felder, feld, initiative(final));

  const grundwerte = grundwerteVon(speziesEintrag);
  if (grundwerte !== null) {
    const b = basiswerte(grundwerte, final);
    setzeZahl(out, felder, 'LE_Wert_1', b.LE);
    for (const feld of ['LE_Max_1', 'LE_Max_2', 'LE_Max_3']) {
      setzeZahl(out, felder, feld, b.LE + held.energienKauf.le);
    }
    setzeZahl(out, felder, 'SK_Wert_1', b.SK);
    for (const feld of ['SK_Max_1', 'SK_Max_2']) setzeZahl(out, felder, feld, b.SK);
    setzeZahl(out, felder, 'ZK_Wert_1', b.ZK);
    for (const feld of ['ZK_Max_1', 'ZK_Max_2']) setzeZahl(out, felder, feld, b.ZK);
    setzeZahl(out, felder, 'GS_Max_1', b.GS); // kein eigenes GS_Wert_1 auf dem Bogen
  }

  // Astral-/Karmaenergie: nur schreiben, wenn eine passende Tradition gewählt ist. Die
  // Leiteigenschaft steht nicht an der Tradition selbst (DatenIndex kennt gar keine
  // Traditionen), sondern an der Profession (`LeitMagie`/`LeitKarma`), s. Typ oben.
  if (held.traditionMagisch !== null && istEigenschaftName(professionEintrag?.LeitMagie)) {
    const leitwert = final[professionEintrag.LeitMagie];
    const ae = astralenergie({ leitwert });
    setzeZahl(out, felder, 'AE_Wert_1', ae);
    for (const feld of ['AE_Max_1', 'AE_Max_2']) setzeZahl(out, felder, feld, ae + held.energienKauf.ae);
  }
  if (held.traditionKarmal !== null && istEigenschaftName(professionEintrag?.LeitKarma)) {
    const leitwert = final[professionEintrag.LeitKarma];
    const ke = karmaenergie({ leitwert });
    setzeZahl(out, felder, 'KE_Wert_1', ke);
    for (const feld of ['KE_Max_1', 'KE_Max_2']) setzeZahl(out, felder, feld, ke + held.energienKauf.ke);
  }

  // --- Fertigkeiten (Talente) --------------------------------------------------------------------
  const talentNr = talentNummern(daten);
  for (const [id, wert] of Object.entries(held.fertigkeiten)) {
    const n = talentNr.get(id);
    if (n === undefined) continue;
    setzeZahl(out, felder, `Talent_FW_${n}`, wert);
  }

  // --- Kampftechniken: freie Zeilen (Name + Wert), Reihenfolge = Objektschlüssel-Reihenfolge --
  const kaTSlots = nummerierteSlots(felder, 'KaT_Name_');
  const kaTEintraege = Object.entries(held.kampftechniken);
  for (let i = 0; i < kaTEintraege.length && i < kaTSlots.length; i++) {
    const eintrag = kaTEintraege[i];
    const slot = kaTSlots[i];
    if (eintrag === undefined || slot === undefined) continue;
    const [name, wert] = eintrag;
    setze(out, felder, `KaT_Name_${slot}`, name);
    setzeZahl(out, felder, `KaT_FW_${slot}`, wert);
  }

  // --- Vor-/Nachteile: freie Zeilen (Anzeigename + Erweiterung) --------------------------------
  schreibeEigenheiten(out, felder, held.vorteile, daten.vorteile, 'Vorteil_', 'Vorteil_Er_');
  schreibeEigenheiten(out, felder, held.nachteile, daten.nachteile, 'Nachteil_', 'Nachteil_Er_');

  // --- Zauber/Liturgien: freie Zeilen (Anzeigename + Wert) -------------------------------------
  schreibeZauberliturgien(out, felder, held.zauber, daten.zauber, 'Zauber_', 'Z_FW_');
  schreibeZauberliturgien(out, felder, held.liturgien, daten.liturgien, 'Liturgie_', 'L_FW_');

  return out;
}

function schreibeEigenheiten(
  out: Map<string, string>, felder: ReadonlySet<string>, gewaehlt: readonly GewaehlteEigenheit[],
  index: ReadonlyMap<string, EigenheitEintrag>, namePraefix: string, erweiterungPraefix: string,
): void {
  const slots = nummerierteSlots(felder, namePraefix);
  for (let i = 0; i < gewaehlt.length && i < slots.length; i++) {
    const eintrag = gewaehlt[i];
    const slot = slots[i];
    if (eintrag === undefined || slot === undefined) continue;
    const daten = index.get(eintrag.id) as EigenheitEintragErweitert | undefined;
    const anzeige = daten?.['Name divers'] ?? eintrag.id;
    setze(out, felder, `${namePraefix}${slot}`, anzeige);
    if (eintrag.erweiterung !== undefined) {
      setze(out, felder, `${erweiterungPraefix}${slot}`, eintrag.erweiterung);
    }
  }
}

function schreibeZauberliturgien(
  out: Map<string, string>, felder: ReadonlySet<string>, gewaehlt: Readonly<Record<string, number>>,
  index: ReadonlyMap<string, ZauberLiturgieEintrag>, namePraefix: string, wertPraefix: string,
): void {
  const slots = nummerierteSlots(felder, namePraefix);
  const eintraege = Object.entries(gewaehlt);
  for (let i = 0; i < eintraege.length && i < slots.length; i++) {
    const eintrag = eintraege[i];
    const slot = slots[i];
    if (eintrag === undefined || slot === undefined) continue;
    const [id, wert] = eintrag;
    const daten = index.get(id) as ZauberLiturgieEintragErweitert | undefined;
    const anzeige = daten?.Name ?? id;
    setze(out, felder, `${namePraefix}${slot}`, anzeige);
    setzeZahl(out, felder, `${wertPraefix}${slot}`, wert);
  }
}

// === PDF-Felder -> Held ==========================================================================

/**
 * Grenzen der Rückrichtung (nicht alles ist rekonstruierbar):
 *  - Der Bogen zeigt FINALE Eigenschaftswerte (gekauft + Spezies-Modifikator). Ist die Spezies
 *    über `Held_Spezies_Anzeige` auflösbar, werden die UNBEDINGTEN Modifikatoren abgezogen, um
 *    die gekauften Werte zurückzugewinnen (`speziesModifikatoren(ew, null)` — siehe Ruling R13
 *    in character.ts). Eine Wahl-Modifikatorgruppe (z. B. Auelfen: KL-2 ODER KK-2) hat auf dem
 *    Bogen keine eigene Spur, welche Option gewählt wurde — `speziesAbzug` bleibt `null`, der
 *    betroffene Wert bleibt der finale statt des gekauften. Ist die Spezies gar nicht auflösbar,
 *    werden die finalen Werte unverändert als gekaufte übernommen (beste verfügbare Näherung).
 *  - `AP_gesamt`/`AP_ausgegeben` sind reine Ableitungen (`apKonto()`), Held speichert kein
 *    AP-Guthaben — beim Import nichts zu tun.
 *  - `stufe` von Vor-/Nachteilen hat kein eigenes Bogenfeld und geht verloren (kommt beim
 *    nächsten Export als `stufe: 1`/Standardstufe zurück, s. `eigenheitKosten` in apkonto.ts).
 *  - Kampftechniken/Vor-/Nachteile/Zauber/Liturgien belegen nur so viele Zeilen, wie der Bogen
 *    hat; überzählige gewählte Einträge beim Export gehen für die Rückrichtung verloren, weil
 *    sie nie geschrieben wurden (nicht ein Fehler dieser Funktion, sondern der Kapazität).
 */
export function felderZuHeld(werte: ReadonlyMap<string, string>, daten: DatenIndex): Held {
  const held = leererHeld();

  const gib = (feld: string): string => werte.get(feld) ?? '';

  held.meta = {
    name: gib('Held_Name'),
    familie: gib('Held_Familie'),
    geburtsort: gib('Held_Geburtsort'),
    geburtsdatum: gib('Held_Geburtsdatum'),
    alter: gib('Held_Alter'),
    geschlecht: gib('Held_Geschlecht'),
    groesse: gib('Held_Groesse'),
    gewicht: gib('Held_Gewicht'),
    haarfarbe: gib('Held_Haare'),
    augenfarbe: gib('Held_Augen'),
    titel: gib('Held_Titel'),
    sozialstatus: gib('Held_Sozialstatus'),
    charakteristika: gib('Held_Charakteristika'),
    sonstiges: held.meta.sonstiges, // kein Bogenfeld zugeordnet (s. Brief), bleibt leer
  };

  const speziesAnzeige = werte.get('Held_Spezies_Anzeige') ?? '';
  const speziesId = ermittleIdVonName(
    daten.spezies, (e) => (e as SpeziesEintragErweitert)['Name divers'], speziesAnzeige,
  );
  held.spezies = speziesId;

  const kulturAnzeige = werte.get('Held_Kultur_Anzeige') ?? '';
  held.kultur = ermittleIdVonName(
    daten.kulturen, (e) => (e as KulturEintragErweitert)['Name Plural'], kulturAnzeige,
  );

  const professionAnzeige = werte.get('Held_Profession_Anzeige');
  held.profession = professionAnzeige !== undefined && professionAnzeige.length > 0 ? professionAnzeige : null;

  // --- Eigenschaften: final -> gekauft (nur unbedingte Modifikatoren abziehbar, s. Doku oben) --
  const speziesEintrag = speziesId !== null
    ? (daten.spezies.get(speziesId) as SpeziesEintragErweitert | undefined)
    : undefined;
  const modifikatoren = speziesEintrag !== undefined
    ? speziesModifikatoren(speziesEintrag.EW, null)
    : {};
  for (const name of EIGENSCHAFTEN) {
    const roh = werte.get(`${name}_1`);
    const final = roh !== undefined ? Number(roh) : NaN;
    if (!Number.isFinite(final)) continue;
    held.eigenschaftenGekauft[name] = final - (modifikatoren[name] ?? 0);
  }

  // --- Fertigkeiten (Talente): PDF-Zeilennummer -> Talent-ID -----------------------------------
  const nummerZuTalent = new Map<number, string>();
  for (const [id, n] of talentNummern(daten)) nummerZuTalent.set(n, id);
  for (const [feld, wert] of werte) {
    const treffer = /^Talent_FW_(\d+)$/.exec(feld);
    if (treffer === null) continue;
    const n = treffer[1];
    if (n === undefined) continue;
    const id = nummerZuTalent.get(Number(n));
    if (id === undefined) continue;
    const zahl = Number(wert);
    if (Number.isFinite(zahl)) held.fertigkeiten[id] = zahl;
  }

  // --- Kampftechniken: Name steht direkt in KaT_Name_<n>, kein Nachschlagen nötig --------------
  for (const slot of nummerierteSlots(werte.keys(), 'KaT_Name_')) {
    const name = werte.get(`KaT_Name_${slot}`);
    if (name === undefined || name.length === 0) continue;
    const wert = Number(werte.get(`KaT_FW_${slot}`) ?? '');
    if (Number.isFinite(wert)) held.kampftechniken[name] = wert;
  }

  // --- Vor-/Nachteile / Zauber / Liturgien -------------------------------------------------------
  held.vorteile = leseEigenheiten(werte, daten.vorteile, 'Vorteil_', 'Vorteil_Er_');
  held.nachteile = leseEigenheiten(werte, daten.nachteile, 'Nachteil_', 'Nachteil_Er_');
  held.zauber = leseZauberliturgien(werte, daten.zauber, 'Zauber_', 'Z_FW_');
  held.liturgien = leseZauberliturgien(werte, daten.liturgien, 'Liturgie_', 'L_FW_');

  return held;
}

function leseEigenheiten(
  werte: ReadonlyMap<string, string>, index: ReadonlyMap<string, EigenheitEintrag>,
  namePraefix: string, erweiterungPraefix: string,
): GewaehlteEigenheit[] {
  const out: GewaehlteEigenheit[] = [];
  for (const slot of nummerierteSlots(werte.keys(), namePraefix)) {
    const anzeige = werte.get(`${namePraefix}${slot}`);
    if (anzeige === undefined || anzeige.length === 0) continue;
    const id = ermittleIdVonName(index, (e) => (e as EigenheitEintragErweitert)['Name divers'], anzeige)
      ?? (index.has(anzeige) ? anzeige : null);
    if (id === null) continue;
    const eintrag: GewaehlteEigenheit = { id };
    const erweiterung = werte.get(`${erweiterungPraefix}${slot}`);
    if (erweiterung !== undefined && erweiterung.length > 0) eintrag.erweiterung = erweiterung;
    out.push(eintrag);
  }
  return out;
}

function leseZauberliturgien(
  werte: ReadonlyMap<string, string>, index: ReadonlyMap<string, ZauberLiturgieEintrag>,
  namePraefix: string, wertPraefix: string,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const slot of nummerierteSlots(werte.keys(), namePraefix)) {
    const anzeige = werte.get(`${namePraefix}${slot}`);
    if (anzeige === undefined || anzeige.length === 0) continue;
    const id = ermittleIdVonName(index, (e) => (e as ZauberLiturgieEintragErweitert).Name, anzeige)
      ?? (index.has(anzeige) ? anzeige : null);
    if (id === null) continue;
    const wert = Number(werte.get(`${wertPraefix}${slot}`) ?? '');
    if (Number.isFinite(wert)) out[id] = wert;
  }
  return out;
}
