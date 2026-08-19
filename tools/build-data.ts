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
        continue;
      }
      // A *GetInfo call that returns the collection size means "unknown key".
      if (value === spec.count) continue;
      if (isEmpty(value)) continue;
      row[field] = value;
      usable = true;
    }
    if (!usable) continue;
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
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
