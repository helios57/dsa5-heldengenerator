import { test, expect } from '@playwright/test';
import { createRulesContext } from '../../tools/acrobat-shim.ts';
import {
  buildDataset, DATASETS, normalisiereText, resetSuppressionCounts, suppressionCounts,
} from '../../tools/build-data.ts';
import type { DatasetSpec } from '../../tools/build-data.ts';
import type { RulesContext } from '../../tools/acrobat-shim.ts';
import { JS_DIR } from '../../tools/paths.ts';

let ctx: RulesContext;
test.beforeAll(() => {
  ctx = createRulesContext(JS_DIR);
});

test('reports the documented collection sizes', () => {
  const sizes: Array<[string, number]> = [
    ['TalentGetInfo', 61], ['SpeziesGetInfo', 46], ['KulturGetInfo', 56],
    ['ProfessionGetInfo', 951], ['ZauberGetInfo', 856], ['LiturgieGetInfo', 349],
    ['VorteilGetInfo', 234], ['NachteilGetInfo', 161], ['KampftechnikGetInfo', 22],
  ];
  for (const [fn, size] of sizes) expect(ctx.call(fn, '', ''), fn).toBe(size);
});

test('the Acrobat host stub is genuinely reachable via unqualified `this`', () => {
  // Regression guard: in a vm context, unqualified top-level `this` resolves to the
  // context's global object, NOT to a property literally named "this" on the sandbox.
  // Host members must be assigned onto the sandbox root for `this.getField(...)` etc.
  // to work inside loaded scripts.
  expect(() => ctx.call('this.getField', 'X')).not.toThrow();
  const field = ctx.call('this.getField', 'X') as { value: unknown };
  expect(field).toBeTruthy();
  expect(field.value).toBe('');
  expect(ctx.call('this.calculateNow')).toBeUndefined();
});

test('reads a Talent with its check attributes and column', () => {
  expect(ctx.call('TalentGetInfo', 1, 'Name')).toBe('Fliegen');
  expect(ctx.call('TalentGetInfo', 1, 'Probe')).toEqual(['MU', 'IN', 'GE']);
  expect(ctx.call('TalentGetInfo', 1, 'SF')).toBe('B');
  expect(ctx.call('TalentGetInfo', 1, 'Gruppe')).toBe('Körper');
});

test('Vorteil costs live under BasisKosten, and unknown keys fall back silently', () => {
  expect(ctx.call('VorteilGetInfo', 'VT201', 'Name divers')).toBe('Zauberer:in');
  expect(ctx.call('VorteilGetInfo', 'VT201', 'BasisKosten')).toBe('25');
  expect(ctx.call('VorteilGetInfo', 'VT201', 'AP')).toBe(234); // the trap
});

test('Nachteil costs are stored negative', () => {
  expect(ctx.call('NachteilGetInfo', 'NT65', 'BasisKosten')).toBe('-30');
});

test('rules text is available for the rule cards', () => {
  const regel = ctx.call('VorteilGetInfo', 'VT1', 'Regel');
  expect(typeof regel).toBe('string');
  expect(regel as string).toContain('Regel:');
  expect(regel as string).toContain('Voraussetzung');
});

test('Erfahrungsgrad AP matches the official table', () => {
  const expected = [900, 1000, 1100, 1200, 1400, 1700, 2100];
  expected.forEach((ap, i) => expect(ctx.call('ErfahrungsgradGetInfo', i, 'AP')).toBe(ap));
});

test('buildDataset drops fallback values and keeps real ones', () => {
  const spec = DATASETS.find((d) => d.key === 'talente');
  expect(spec).toBeDefined();
  const rows = buildDataset(ctx, spec!);
  expect(rows.length).toBe(61);
  expect(rows[0]).toMatchObject({ ID: 'Tal1', Name: 'Fliegen', SF: 'B' });
});

test('buildDataset drops a field whose raw value equals the unknown-key fallback sentinel', () => {
  // A deterministic, isolated stand-in for the real *GetInfo functions' "unknown key
  // returns the collection size" convention (see the VT201/AP trap above), so this
  // exercises buildDataset's `value === spec.count` guard directly instead of relying on
  // real PDF data happening to contain such a row (previously asserted via
  // `not.toHaveProperty('__fallback')` - a property nothing ever sets, so that check was
  // vacuously true no matter what buildDataset did).
  const mockCtx: RulesContext = {
    failed: [],
    call: (_fnName: string, ...args: Array<string | number>): unknown => {
      const [i, field] = args;
      if (field === 'Fallback') return 3; // equals the mock spec's count below
      if (field === 'Real') return `wert-${i}`;
      return '';
    },
  };
  const spec: DatasetSpec = { key: 'mock', fn: 'MockGetInfo', count: 3, fields: ['Real', 'Fallback'] };
  const rows = buildDataset(mockCtx, spec);
  expect(rows.length).toBe(3);
  for (const row of rows) {
    expect(row).toHaveProperty('Real');
    expect(row).not.toHaveProperty('Fallback');
  }
});

test('suppressionCounts reports broken lookups and unknown-key fallback collisions', () => {
  const mockCtx: RulesContext = {
    failed: [],
    call: (_fnName: string, ...args: Array<string | number>): unknown => {
      const [, field] = args;
      if (field === 'Broken') throw new Error('this field always throws');
      if (field === 'Fallback') return 2; // equals the mock spec's count below
      return `wert`;
    },
  };
  const spec: DatasetSpec = {
    key: 'mock', fn: 'MockGetInfo', count: 2, fields: ['Real', 'Broken', 'Fallback'],
  };
  resetSuppressionCounts();
  buildDataset(mockCtx, spec);
  const counts = suppressionCounts();
  // one row per index (1..2), each hits both the broken lookup and the fallback collision
  expect(counts.brokenLookups).toBe(2);
  expect(counts.fallbackCollisions).toBe(2);
});

// --- Ruling R9: legacy mojibake normalisation ---

test('normalisiereText maps all three codepoints, recursing through arrays and objects, leaving non-strings untouched', () => {
  const input = {
    a: 'ChrSsirSsr-Priester',
    b: ['AlBeni', 'ŒAnfang'],
    c: { nested: 'xyŒzw' },
    n: 42,
    bool: true,
    nil: null,
  };
  const out = normalisiereText(input);
  expect(out).toEqual({
    a: "Chr'Ssir'Ssr-Priester",
    b: ["Al'Beni", '‚Anfang‘'],
    c: { nested: "x'y‚z‘w" },
    n: 42,
    bool: true,
    nil: null,
  });
  // must not mutate the input
  expect(input.a).toBe('ChrSsirSsr-Priester');
});

test('the generated professionen dataset contains the official spellings', () => {
  const spec = DATASETS.find((d) => d.key === 'professionen');
  expect(spec).toBeDefined();
  const rows = buildDataset(ctx, spec!);
  // The canonical (Regel-Wiki filename) spelling is the masculine form for this profession;
  // check across all three gendered name fields so the assertion isn't tied to one variant.
  const names = rows.flatMap((r) => [r['Name divers'], r['Name männlich'], r['Name weiblich']]);
  expect(names).toContain("Chr'Ssir'Ssr-Priester");
  expect(names).toContain("Al'Beni");
});

// --- Ruling R10: zero-based collections were losing their first entry ---

test('every dataset yields the documented row count (regression guard for the zeroBased bug)', () => {
  const expected: Record<string, number> = {
    talente: 61,
    spezies: 47,
    kulturen: 57,
    professionen: 952,
    vorteile: 235,
    nachteile: 162,
    kampftechniken: 22,
    zauber: 857,
    liturgien: 350,
    sprachen: 102,
    traditionen: 62,
    eigenschaften: 8,
  };
  for (const spec of DATASETS) {
    const rows = buildDataset(ctx, spec);
    expect(rows.length, spec.key).toBe(expected[spec.key]);
  }
});

test('vorteile includes the first entry in the rulebook, Adel I (index 0)', () => {
  const spec = DATASETS.find((d) => d.key === 'vorteile');
  expect(spec).toBeDefined();
  const rows = buildDataset(ctx, spec!);
  const names = rows.map((r) => r['Name divers']);
  expect(names).toContain('Adel I');
});

test('no generated dataset contains any legacy mojibake codepoint', () => {
  for (const spec of DATASETS) {
    const rows = buildDataset(ctx, spec);
    const json = JSON.stringify(rows);
    expect(json, spec.key).not.toContain('');
    expect(json, spec.key).not.toContain('Œ');
    expect(json, spec.key).not.toContain('');
  }
});

// --- Ruling R11: `Sprachversion` must resolve to 'DE', or DokumentSprache() breaks ---
//
// DokumentSprache() only falls back to 'DE' when `fFeld != null` is false. An inert
// stub field returned by getField() is never null, so that guard never trips and the
// stub's empty-string value wins -- DokumentSprache() then returns '' instead of 'DE'.
// Several *GetInfo lookups (e.g. SpeziesGetInfo's 'Name Plural' via IDSpezies) pass
// that language straight into a switch with no '' case and silently fall through to a
// numeric/empty fallback. This regression guard fails against a name-blind shim.

test('DokumentSprache() resolves to DE through the rules context', () => {
  expect(ctx.call('DokumentSprache')).toBe('DE');
});

test('the generated spezies dataset carries species names for every row', () => {
  const spec = DATASETS.find((d) => d.key === 'spezies');
  expect(spec).toBeDefined();
  const rows = buildDataset(ctx, spec!);
  expect(rows.length).toBe(47);
  for (const row of rows) {
    expect(row['Name Plural'], JSON.stringify(row)).toBeTruthy();
    expect(row['Name Plural']).not.toBe('');
  }
});

test('a known species (S36) resolves to its official plural name', () => {
  const spec = DATASETS.find((d) => d.key === 'spezies');
  expect(spec).toBeDefined();
  const rows = buildDataset(ctx, spec!);
  const s36 = rows.find((r) => r['ID'] === 'S36');
  expect(s36).toMatchObject({ 'Name Plural': 'Achaz' });
});

// --- eigenschaften: the only mapping from Eig1..Eig8 to MU/KL/... and to spezies.EW keys ---

test('eigenschaften maps all eight attributes in sheet order, including the last (KK)', () => {
  const spec = DATASETS.find((d) => d.key === 'eigenschaften');
  expect(spec).toBeDefined();
  const rows = buildDataset(ctx, spec!);
  expect(rows.map((r) => r['Kurz'])).toEqual(['MU', 'KL', 'IN', 'CH', 'FF', 'GE', 'KO', 'KK']);
  expect(rows.map((r) => r['ID'])).toEqual(
    ['Eig1', 'Eig2', 'Eig3', 'Eig4', 'Eig5', 'Eig6', 'Eig7', 'Eig8'],
  );
  // Regression guard for the 'Nr'/unknown-key collision documented in DATASETS: the last row
  // (KK) must still be present and complete even though its raw Nr (7) equals this dataset's
  // unknown-pWas fallback (also 7) - 'Nr' is excluded from the field list specifically to
  // avoid that trap, and this asserts nothing else about the row went missing as a result.
  const kk = rows.find((r) => r['ID'] === 'Eig8');
  expect(kk).toEqual({ ID: 'Eig8', Kurz: 'KK', Lang: 'Körperkraft', Opt_ID: '8' });
});

// --- Ruling R14: VorteilGetInfo/NachteilGetInfo 'Liste' depends on a global "which
// sourcebooks are enabled" filter field (WerkFilter -> getField('GlobFiltWerkeAuswahl')).
// An inert stub field always reports numItems: 0, so every *Array() helper behind 'Liste'
// silently returned [] instead of throwing. The shim now overrides WerkFilter to mean
// "every sourcebook enabled" so real option labels come through.

test('VorteilGetInfo Liste resolves real sub-option labels, not an empty array', () => {
  // VT227 "Zusätzliche Gliedmaßen" is exactly the case spezies rows reference via the
  // "VT227_1" sub-option code (see spezies.Vorteil, e.g. S36 -> [["VT227","VT227_1"]]).
  expect(ctx.call('VorteilGetInfo', 'VT227', 'Liste')).toEqual(['Schwanz']);
});

test('the generated vorteile dataset carries a non-empty Liste for VT227', () => {
  const spec = DATASETS.find((d) => d.key === 'vorteile');
  expect(spec).toBeDefined();
  const rows = buildDataset(ctx, spec!);
  const vt227 = rows.find((r) => r['ID'] === 'VT227');
  expect(vt227).toMatchObject({ Liste: ['Schwanz'] });
});

// --- zauber.Probe must have the same array shape as talente.Probe, not a joined string ---

test('zauber Probe is an array of three attribute abbreviations, like talente.Probe', () => {
  const spec = DATASETS.find((d) => d.key === 'zauber');
  expect(spec).toBeDefined();
  const rows = buildDataset(ctx, spec!);
  expect(rows.length).toBeGreaterThan(0);
  const probe = rows[0]!['Probe'];
  expect(Array.isArray(probe)).toBe(true);
  expect(probe).toHaveLength(3);
  for (const attribut of probe as unknown[]) {
    expect(typeof attribut).toBe('string');
    expect(attribut).toMatch(/^[A-Z]{2}$/);
  }
  // every row, not just the first — Probe1/Probe2/Probe3 always co-occur with Probe
  for (const row of rows) expect(Array.isArray(row['Probe']), JSON.stringify(row)).toBe(true);
});

test('liturgien Probe is likewise normalised to an array', () => {
  const spec = DATASETS.find((d) => d.key === 'liturgien');
  expect(spec).toBeDefined();
  const rows = buildDataset(ctx, spec!);
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) expect(Array.isArray(row['Probe']), JSON.stringify(row)).toBe(true);
});

