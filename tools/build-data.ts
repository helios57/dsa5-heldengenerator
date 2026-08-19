import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createRulesContext } from './acrobat-shim.ts';
import type { RulesContext } from './acrobat-shim.ts';
import { JS_DIR, DATA_DIR } from './paths.ts';

export type DatasetSpec = {
  readonly key: string;
  readonly fn: string;
  readonly count: number;
  readonly fields: readonly string[];
  readonly zeroBased?: boolean;
};

export const DATASETS: readonly DatasetSpec[] = [
  { key: 'talente', fn: 'TalentGetInfo', count: 61,
    fields: ['ID', 'Name', 'Probe', 'SF', 'Gruppe', 'Verweise', 'Aktivieren', 'Gebiete'] },
  { key: 'spezies', fn: 'SpeziesGetInfo', count: 46, zeroBased: true,
    fields: ['ID', 'Name Plural', 'Name männlich', 'Name weiblich', 'Name divers',
             'Gesamt', 'AP', 'LE', 'SK', 'ZK', 'GS', 'EW',
             'Kulturen', 'Vorteil', 'Nachteil', 'Größe', 'Gewicht', 'Alter', 'Werke',
             'Haartyp'] },
  { key: 'kulturen', fn: 'KulturGetInfo', count: 56, zeroBased: true,
    fields: ['ID', 'Name Plural', 'Gesamt', 'SFAllgemein', 'Sprache', 'Talent', 'Typ', 'Werke'] },
  { key: 'professionen', fn: 'ProfessionGetInfo', count: 951, zeroBased: true,
    fields: ['Name divers', 'Name männlich', 'Name weiblich', 'Gesamt', 'Typ', 'Werke',
             'Talent', 'Kampftechnik', 'Kampftechnik-Tausch', 'Zauber', 'Liturgie', 'Segen',
             'SFAllgemein', 'SFKampf', 'SFMagie', 'SFKarma', 'Sprache', 'Schrift',
             'Vorteil', 'Nachteil', 'EWMin', 'LeitMagie', 'LeitKarma', 'Info'] },
  { key: 'vorteile', fn: 'VorteilGetInfo', count: 234, zeroBased: true,
    fields: ['ID', 'Name divers', 'BasisKosten', 'Regel', 'Typ', 'Verweise', 'Werke', 'Liste'] },
  { key: 'nachteile', fn: 'NachteilGetInfo', count: 161, zeroBased: true,
    fields: ['ID', 'Name divers', 'BasisKosten', 'Regel', 'Typ', 'Verweise', 'Werke', 'Liste'] },
  { key: 'kampftechniken', fn: 'KampftechnikGetInfo', count: 22,
    fields: ['Name', 'Typ', 'SF', 'Werke', 'Leit', 'AT', 'PA1', 'PA2', 'Nummer'] },
  { key: 'zauber', fn: 'ZauberGetInfo', count: 856, zeroBased: true,
    fields: ['ID', 'Name', 'Probe', 'SF', 'Merkmal', 'Werke', 'Traditionen', 'Probe1', 'Probe2', 'Probe3'] },
  { key: 'liturgien', fn: 'LiturgieGetInfo', count: 349, zeroBased: true,
    fields: ['ID', 'Name', 'Probe', 'SF', 'Werke', 'Traditionen', 'Probe1', 'Probe2', 'Probe3'] },
  { key: 'sprachen', fn: 'SpracheGetInfo', count: 101, zeroBased: true,
    fields: ['Name', 'Werke', 'Max', 'Gruppe', 'Schrift'] },
  { key: 'traditionen', fn: 'TraditionGetInfo', count: 61, zeroBased: true,
    fields: ['Name', 'Werke', 'Leit', 'Faktor', 'Kosten', 'Kurz'] },
  // EigenschaftGetInfo(0..7, pWas) is the only mapping from Eig1..Eig8 (used as keys inside
  // e.g. spezies.EW, [["Eig3",1],...]) to both the sheet's attribute abbreviations (Kurz:
  // MU/KL/IN/CH/FF/GE/KO/KK) and their full PDF field labels (Lang: Mut/Klugheit/...).
  // Deliberately excludes 'Nr' and 'Feld':
  //  - 'Nr' is the same 0-7 index as the zeroBased loop position, AND for the last entry
  //    (i=7, KK) its legitimate value is literally 7 - identical to this dataset's
  //    unknown-pWas fallback (also 7, verified: EigenschaftGetInfo(i,'Bogus') === 7 for every
  //    i). buildDataset's `value === spec.count` heuristic would silently drop that one
  //    genuine value, so 'Nr' is left out rather than risk it (it's redundant with the row
  //    order anyway).
  //  - 'Feld' calls this.getField(...) and returns a Field object, not serialisable data; our
  //    shim's stub getField() also can't distinguish which field name was requested, so every
  //    row would collapse to the same empty stub.
  { key: 'eigenschaften', fn: 'EigenschaftGetInfo', count: 7, zeroBased: true,
    fields: ['ID', 'Kurz', 'Lang', 'Opt_ID'] },
  // sf_allgemein/sf_kampf/sf_magisch/sf_karmal/ausruestung: none of these five *GetInfo
  // functions expose an 'ID' sInfoID/pInfoID case (verified by reading every `case` in each
  // build/js/<Fn>.js's second switch) — unlike talente/vorteile/nachteile/zauber/liturgien,
  // rows are addressed purely by their zero-based index or by name string, so there is no
  // 'ID' field to capture ("ID (if it exists)" — it doesn't, here). Every dataset's per-key
  // unknown-field fallback sentinel (the `default: return N` in that switch) was read
  // directly from source and confirmed equal to `count` below, e.g. SFAllgGetInfo's
  // `default: return 611`.
  { key: 'sf_allgemein', fn: 'SFAllgGetInfo', count: 611, zeroBased: true,
    fields: ['Name divers', 'Name männlich', 'Name weiblich', 'BasisKosten', 'Regel', 'Typ',
             'Subtyp', 'Verweise', 'Werke', 'Liste'] },
  { key: 'sf_kampf', fn: 'SFKampfGetInfo', count: 356, zeroBased: true,
    fields: ['Name divers', 'Name männlich', 'Name weiblich', 'BasisKosten', 'Regel', 'Typ',
             'Subtyp', 'BSP', 'Verweise', 'Werke'] },
  { key: 'sf_magisch', fn: 'SFMagGetInfo', count: 880, zeroBased: true,
    fields: ['Name divers', 'Name männlich', 'Name weiblich', 'BasisKosten', 'Regel', 'Typ',
             'Subtyp', 'Gruppe', 'Merkmal', 'AsP', 'VP', 'Verweise', 'Werke', 'Liste',
             'Tradverweise'] },
  { key: 'sf_karmal', fn: 'SFKarmGetInfo', count: 476, zeroBased: true,
    fields: ['Name divers', 'Name männlich', 'Name weiblich', 'BasisKosten', 'Regel', 'Typ',
             'Subtyp', 'Aspekt', 'Trance', 'Tradition', 'Verweise', 'Werke', 'Liste',
             'Tradverweise'] },
  // Besitz*: field names differ from every other dataset (Gewicht/Wert/Typ, not
  // Kosten/BasisKosten/Gruppe) — kept verbatim from BesitzGetInfo's own pInfoID cases
  // rather than renamed, so a lookup against the PDF source stays a straight text match.
  { key: 'ausruestung', fn: 'BesitzGetInfo', count: 3308, zeroBased: true,
    fields: ['Name', 'Gewicht', 'Wert', 'Typ'] },
];

const isEmpty = (v: unknown): boolean =>
  v === '' || v === undefined || v === null || (Array.isArray(v) && v.length === 0);

/**
 * Ruling R9: the extracted corpus carries legacy mojibake from a lossy encoding
 * conversion. Three codepoints are affected, evidenced by counts and pairing:
 *  - U+0090            -> U+0027 apostrophe (')      [953 occurrences]
 *  - U+0152 'Œ'        -> U+201A German opening quote (‚) [216 occurrences]
 *  - U+008D            -> U+2018 German closing quote (') [216 occurrences, paired with U+0152]
 */
const MOJIBAKE_MAP: ReadonlyMap<string, string> = new Map([
  ['', "'"],
  ['Œ', '‚'],
  ['', '‘'],
]);

function normalisiereString(value: string): string {
  let result = value;
  for (const [from, to] of MOJIBAKE_MAP) {
    result = result.split(from).join(to);
  }
  return result;
}

/**
 * Recursively replaces the legacy mojibake codepoints (see MOJIBAKE_MAP) in every
 * string reached through strings, arrays and plain objects. Non-string leaves
 * (numbers, booleans, null) pass through untouched. Never mutates its input.
 */
export function normalisiereText<T>(value: T): T {
  if (typeof value === 'string') {
    return normalisiereString(value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item: unknown) => normalisiereText(item)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = normalisiereText(val);
    }
    return out as unknown as T;
  }
  return value;
}

/**
 * talente.Probe already comes back from the source JS as an array (`['MU','IN','GE']`),
 * but zauber.Probe and liturgien.Probe come back as a single slash-joined string
 * (`"IN/KO/KK"`) — a different shape for the same concept. Both feed the same
 * `readonly EigenschaftName[]` parameters in src/core/limits.ts (maxFertigkeit,
 * maxZauber), so every dataset's `Probe` field must have the same array shape.
 * `Probe1`/`Probe2`/`Probe3` give a clean, already-split source for the string form;
 * used here in preference to parsing the joined string. Mutates `row` in place.
 */
function normalisiereProbe(row: Record<string, unknown>): void {
  const { Probe1, Probe2, Probe3 } = row;
  if (typeof Probe1 === 'string' && typeof Probe2 === 'string' && typeof Probe3 === 'string') {
    row['Probe'] = [Probe1, Probe2, Probe3];
  }
}

/**
 * `buildDataset` silently `continue`s past two kinds of suppressed data: a lookup that
 * threw (`catch { continue }` — the field genuinely isn't valid for that function, e.g.
 * calling a spezies-only field on a talent), and a value that collided with the
 * unknown-key fallback sentinel (`value === spec.count`, see the `eigenschaften` DATASETS
 * comment above for a worked example of that trap). Both are legitimate to suppress on a
 * per-field basis, but a build where suppressions spike silently would be easy to miss —
 * these counters make them visible via `suppressionCounts()` / the summary line `main()`
 * prints. Module-level (not per-call) so `main()` can report one total across every
 * dataset; `resetSuppressionCounts()` exists so callers (tests, `main()`) can measure a
 * clean window.
 */
let brokenLookups = 0;
let fallbackCollisions = 0;

export function resetSuppressionCounts(): void {
  brokenLookups = 0;
  fallbackCollisions = 0;
}

export function suppressionCounts(): { brokenLookups: number; fallbackCollisions: number } {
  return { brokenLookups, fallbackCollisions };
}

export function buildDataset(ctx: RulesContext, spec: DatasetSpec): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  const start = spec.zeroBased ? 0 : 1;

  for (let i = start; i <= spec.count; i++) {
    const row: Record<string, unknown> = {};
    let usable = false;
    for (const field of spec.fields) {
      let value: unknown;
      try {
        value = ctx.call(spec.fn, i, field);
      } catch {
        brokenLookups++;
        continue;
      }
      // A *GetInfo call that returns the collection size means "unknown key".
      if (value === spec.count) {
        fallbackCollisions++;
        continue;
      }
      if (isEmpty(value)) continue;
      row[field] = value;
      usable = true;
    }
    if (!usable) continue;
    normalisiereProbe(row);
    const normalised = normalisiereText(row);
    const id = normalised['ID'];
    if (typeof id === 'string') {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    rows.push(normalised);
  }
  return rows;
}

async function main(): Promise<void> {
  const ctx = createRulesContext(JS_DIR);
  if (ctx.failed.length) {
    console.warn(`note: ${ctx.failed.length} scripts did not load (UI-only, expected)`);
  }
  await mkdir(DATA_DIR, { recursive: true });
  resetSuppressionCounts();
  let total = 0;
  for (const spec of DATASETS) {
    const rows = buildDataset(ctx, spec);
    const json = JSON.stringify(rows);
    await writeFile(join(DATA_DIR, `${spec.key}.json`), json, 'utf8');
    total += json.length;
    console.log(
      `${spec.key.padEnd(16)} ${String(rows.length).padStart(5)} rows  ${(json.length / 1024).toFixed(0)} KB`,
    );
  }
  console.log(`total ${(total / 1024 / 1024).toFixed(2)} MB`);
  const { brokenLookups: broken, fallbackCollisions: collisions } = suppressionCounts();
  console.log(
    `suppressions: ${broken} broken lookup(s) (caught exceptions), ` +
    `${collisions} unknown-key fallback collision(s) dropped`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
