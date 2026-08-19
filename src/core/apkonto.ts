/**
 * AP-Konto nach DSA5 (Spec §5.5). Rechnet die gesamte Erschaffung eines Helden gegen sein
 * Erfahrungsgrad-Budget auf. `src/core/` bleibt PURE: dieses Modul lädt keine Daten selbst
 * — Aufrufer bauen einen `DatenIndex` (Nachschlage-Maps über app/data/*.json) und übergeben ihn.
 */
import { erfahrungsgrad } from './experience.ts';
import { EIGENSCHAFTEN } from './derived.ts';
import { eigenschaftKostenGesamt, fertigkeitKosten, energieKosten } from './costs.ts';
import { KAMPFTECHNIK_START } from './limits.ts';
import type { Held, GewaehlteEigenheit } from './character.ts';

export type SpeziesEintrag = {
  readonly AP: number;
  readonly Vorteil?: ReadonlyArray<readonly [string, string]>;
  readonly Nachteil?: ReadonlyArray<readonly [string, string]>;
};
export type KulturEintrag = { readonly Gesamt: string };
export type ProfessionEintrag = { readonly Gesamt: string };
export type TalentEintrag = { readonly SF: string; readonly Aktivieren?: string };
export type KampftechnikEintrag = { readonly SF: string };
export type EigenheitEintrag = { readonly BasisKosten: string };
export type ZauberLiturgieEintrag = { readonly SF: string };

/** Nachschlage-Tabellen über app/data/*.json, jeweils per ID (Kampftechniken: per Name). */
export type DatenIndex = {
  readonly spezies: ReadonlyMap<string, SpeziesEintrag>;
  readonly kulturen: ReadonlyMap<string, KulturEintrag>;
  readonly professionen: ReadonlyMap<string, ProfessionEintrag>;
  readonly talente: ReadonlyMap<string, TalentEintrag>;
  readonly kampftechniken: ReadonlyMap<string, KampftechnikEintrag>;
  readonly vorteile: ReadonlyMap<string, EigenheitEintrag>;
  readonly nachteile: ReadonlyMap<string, EigenheitEintrag>;
  readonly zauber: ReadonlyMap<string, ZauberLiturgieEintrag>;
  readonly liturgien: ReadonlyMap<string, ZauberLiturgieEintrag>;
};

export type APKonto = {
  readonly budget: number;
  readonly ausgegeben: number;
  readonly rest: number;
  readonly posten: ReadonlyArray<{ readonly kategorie: string; readonly ap: number }>;
  readonly vorteilAP: number;
  readonly nachteilAP: number;
};

/** "322+130" -> 452. Profession/Kultur-Pakete können aus mehreren Summanden bestehen. */
function summeGesamt(gesamt: string): number {
  return gesamt.split('+').reduce((summe, teil) => summe + Number(teil), 0);
}

/**
 * "6/24" -> Kosten der gewählten Stufe (1-basiert über `stufe`, Standard 1 = erster Wert).
 * Deckt sowohl einfache BasisKosten ("5", "-30") als auch stufenabhängige ("6/24") ab.
 */
function eigenheitKosten(eintrag: EigenheitEintrag | undefined, gewaehlt: GewaehlteEigenheit): number {
  if (eintrag === undefined) return 0;
  const teile = eintrag.BasisKosten.split('/').map(Number);
  const index = Math.min(Math.max((gewaehlt.stufe ?? 1) - 1, 0), teile.length - 1);
  return teile[index] ?? 0;
}

export function apKonto(held: Held, daten: DatenIndex): APKonto {
  const grad = erfahrungsgrad(held.erfahrungsgrad);
  if (!grad) throw new Error(`unbekannter Erfahrungsgrad: ${held.erfahrungsgrad}`);

  const posten: Array<{ kategorie: string; ap: number }> = [];

  const speziesEintrag = held.spezies !== null ? daten.spezies.get(held.spezies) : undefined;
  posten.push({ kategorie: 'Spezies', ap: speziesEintrag?.AP ?? 0 });

  const kulturEintrag = held.kultur !== null ? daten.kulturen.get(held.kultur) : undefined;
  posten.push({ kategorie: 'Kultur', ap: kulturEintrag ? summeGesamt(kulturEintrag.Gesamt) : 0 });

  const professionEintrag = held.profession !== null ? daten.professionen.get(held.profession) : undefined;
  posten.push({ kategorie: 'Profession', ap: professionEintrag ? summeGesamt(professionEintrag.Gesamt) : 0 });

  posten.push({
    kategorie: 'Eigenschaften',
    ap: eigenschaftKostenGesamt(EIGENSCHAFTEN.map((name) => held.eigenschaftenGekauft[name])),
  });

  let fertigkeitenAP = 0;
  for (const [id, wert] of Object.entries(held.fertigkeiten)) {
    const eintrag = daten.talente.get(id);
    if (eintrag === undefined) continue;
    fertigkeitenAP += fertigkeitKosten(wert, eintrag.SF, { aktivieren: eintrag.Aktivieren === 'ja' });
  }
  posten.push({ kategorie: 'Fertigkeiten', ap: fertigkeitenAP });

  // Kampftechniken beginnen bei KAMPFTECHNIK_START (6), nicht bei 0 — Kosten sind daher die
  // Differenz gegen den Startwert, nicht die volle kumulative Kurve ab 0.
  let kampftechnikenAP = 0;
  for (const [name, wert] of Object.entries(held.kampftechniken)) {
    const eintrag = daten.kampftechniken.get(name);
    if (eintrag === undefined) continue;
    kampftechnikenAP += fertigkeitKosten(wert, eintrag.SF) - fertigkeitKosten(KAMPFTECHNIK_START, eintrag.SF);
  }
  posten.push({ kategorie: 'Kampftechniken', ap: kampftechnikenAP });

  // Vor-/Nachteile: Spezies-gewährte Einträge sind bereits im Spezies-Posten (AP-Feld)
  // eingepreist — sie hier zusätzlich als Ausgabe zu verbuchen würde doppelt zählen. Die
  // Regel verlangt jedoch ausdrücklich, dass sie in die 80-AP-Deckel (vorteilAP/nachteilAP)
  // einfließen, also zählen sie NUR dort mit, nicht im "Vorteile"/"Nachteile"-Posten.
  let vorteilePostenAP = 0;
  let vorteilAP = 0;
  for (const gewaehlt of held.vorteile) {
    const kosten = eigenheitKosten(daten.vorteile.get(gewaehlt.id), gewaehlt);
    vorteilePostenAP += kosten;
    vorteilAP += Math.abs(kosten);
  }
  for (const [id, erweiterung] of speziesEintrag?.Vorteil ?? []) {
    vorteilAP += Math.abs(eigenheitKosten(daten.vorteile.get(id), { id, erweiterung }));
  }
  posten.push({ kategorie: 'Vorteile', ap: vorteilePostenAP });

  // Nachteil-BasisKosten sind im Datensatz NEGATIV gespeichert (z. B. "-30") — sie werden
  // hier nicht erneut negiert. Für den 80-AP-Deckel zählt jedoch die positive Magnitude.
  let nachteilePostenAP = 0;
  let nachteilAP = 0;
  for (const gewaehlt of held.nachteile) {
    const kosten = eigenheitKosten(daten.nachteile.get(gewaehlt.id), gewaehlt);
    nachteilePostenAP += kosten;
    nachteilAP += Math.abs(kosten);
  }
  for (const [id, erweiterung] of speziesEintrag?.Nachteil ?? []) {
    nachteilAP += Math.abs(eigenheitKosten(daten.nachteile.get(id), { id, erweiterung }));
  }
  posten.push({ kategorie: 'Nachteile', ap: nachteilePostenAP });

  // Sonderfertigkeiten: es gibt (noch) keinen committeten Datensatz (app/data/*.json enthält
  // keine sonderfertigkeiten.json), daher lässt sich hier noch nichts nachschlagen. Der
  // Posten wird dennoch ausgewiesen, damit die Kategorie-Liste stabil bleibt.
  posten.push({ kategorie: 'Sonderfertigkeiten', ap: 0 });

  let zauberAP = 0;
  for (const [id, wert] of Object.entries(held.zauber)) {
    const eintrag = daten.zauber.get(id);
    if (eintrag === undefined) continue;
    zauberAP += fertigkeitKosten(wert, eintrag.SF, { aktivieren: true });
  }
  posten.push({ kategorie: 'Zauber', ap: zauberAP });

  let liturgienAP = 0;
  for (const [id, wert] of Object.entries(held.liturgien)) {
    const eintrag = daten.liturgien.get(id);
    if (eintrag === undefined) continue;
    liturgienAP += fertigkeitKosten(wert, eintrag.SF, { aktivieren: true });
  }
  posten.push({ kategorie: 'Liturgien', ap: liturgienAP });

  posten.push({
    kategorie: 'Energien',
    ap: energieKosten(held.energienKauf.le) + energieKosten(held.energienKauf.ae)
      + energieKosten(held.energienKauf.ke),
  });

  const ausgegeben = posten.reduce((summe, p) => summe + p.ap, 0);

  return {
    budget: grad.ap,
    ausgegeben,
    rest: grad.ap - ausgegeben,
    posten,
    vorteilAP,
    nachteilAP,
  };
}
