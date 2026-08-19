import { test, expect } from '@playwright/test';
import { createRulesContext } from '../../tools/acrobat-shim.ts';
import { buildDataset, DATASETS, normalisiereText } from '../../tools/build-data.ts';
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
  for (const row of rows) expect(row).not.toHaveProperty('__fallback');
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
