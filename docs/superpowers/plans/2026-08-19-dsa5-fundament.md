# DSA5 Heldengenerator — Plan 1: Fundament

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the complete DSA5 ruleset from the official PDF into committed JSON datasets, and build a fully tested, strictly typed, DOM-free rules engine on top of it.

**Architecture:** One TypeScript source tree under `src/`. Node 24 runs `.ts` files directly via type stripping, so the build tools and unit tests execute the sources with no compile step; `tsc` compiles the same sources to `app/js/` for the browser. Imports carry explicit `.ts` extensions and `rewriteRelativeImportExtensions` turns them into `.js` on emit. The PDF parser is written browser-first so Plan 3 reuses it unchanged for import/export. The rules engine (`src/core/`) is pure functions over plain objects — no DOM, no I/O, no globals.

**Tech Stack:** TypeScript 6 (`strict`), ES2023 modules, no framework, no bundler. Node 24 for tooling. `@playwright/test` as the single test runner for both unit and browser tests. Exactly three devDependencies: `typescript`, `@playwright/test`, `@types/node` — nothing ships to the browser.

**Spec:** `docs/superpowers/specs/2026-08-19-dsa5-heldengenerator-design.md`

## Global Constraints

- **TypeScript everywhere**, `strict: true`. No `any` in exported signatures. Prefer type guards over casts.
- **Zero runtime dependencies.** Nothing under `src/` may import from `node_modules`. The built site is static files only — no backend, no server-side anything.
- **Browser-compatible sources.** `src/` may use only web-standard APIs: `Uint8Array`, `TextDecoder`, `DecompressionStream`, `Blob`, `Response`, `fetch`. All exist in Node 24, which is what lets the tools reuse them. Node-only APIs (`node:fs`, `node:vm`) are confined to `tools/` and `scripts/`.
- **Explicit `.ts` import extensions** in every relative import. Verified: Node runs them directly, Playwright resolves them, and `tsc` rewrites them to `.js` on emit.
- **Generated data is committed.** `app/data/*.json` is produced by `tools/` and checked in. Consumers never run the tools.
- **Domain vocabulary stays German** in data, domain identifiers and user-facing strings: `Erfahrungsgrad`, `Vorteil`, `Nachteil`, `Fertigkeit`, `Kampftechnik`, `Spezies`, `Kultur`, `Profession`, `Sonderfertigkeit`, `Zauber`, `Liturgie`, `Talent`. Infrastructure identifiers stay English.
- **Source PDF path:** `423187-Charakterbogen_V2_13_(ausfuellbar_selbstrechnend_ohne_Hintergrund)_korr_V2.pdf` in the repo root, exported once from `tools/paths.ts` and never hardcoded again.
- **Node version floor:** 24 (native TypeScript type stripping, `DecompressionStream`).
- **Rules engine is pure.** No module under `src/core/` may perform I/O, read globals, or touch the DOM.

---

## File Structure

```
package.json                 devDeps: typescript, @playwright/test, @types/node. "type": "module"
tsconfig.json                typecheck everything (noEmit)
tsconfig.app.json            emit src/ -> app/js/ for the browser
playwright.config.ts         projects: unit (node), e2e (chromium)
scripts/serve.ts             static server over app/, node:http only
tools/
  paths.ts                   path constants
  pdf-js-extract.ts          PDF -> build/js/*.js (797 functions)
  acrobat-shim.ts            stub Acrobat host for executing extracted JS
  build-data.ts              build/js/*.js -> app/data/*.json
src/
  io/pdf-lexer.ts            PDF value types, tokenizer, filters
  io/pdf-document.ts         xref chain, object streams, PDFDoc
  io/pdf-acroform.ts         field tree walk -> named fields + widgets
  core/types.ts              shared domain types
  core/experience.ts         Erfahrungsgrad table
  core/costs.ts              AP cost formulas
  core/derived.ts            derived values
  core/limits.ts             creation caps and validation
app/
  index.html                 shell
  data/*.json                generated, committed
  js/                        tsc output, gitignored
build/                       intermediate, gitignored
tests/unit/*.spec.ts         rules engine + parser, no browser
tests/e2e/*.spec.ts          browser tests
```

**Why `src/io/pdf-*.ts` is browser-first:** Plan 3 needs the identical parser running in the browser to import filled character sheets. Writing it once and importing it from Node avoids a second implementation that can drift.

---

### Task 1: Project scaffold, TypeScript build and test harness

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.app.json`, `playwright.config.ts`, `.gitignore`
- Create: `tools/paths.ts`, `scripts/serve.ts`, `app/index.html`
- Test: `tests/unit/smoke.spec.ts`, `tests/e2e/smoke.spec.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `tools/paths.ts` exporting `ROOT`, `APP_DIR`, `DATA_DIR`, `BUILD_DIR`, `JS_DIR`, `SOURCE_PDF` — all `string`, absolute. `npm test` runs both projects; `npm run typecheck` type-checks everything.

- [ ] **Step 1: Write the failing tests**

`tests/unit/smoke.spec.ts`:
```ts
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { SOURCE_PDF, APP_DIR } from '../../tools/paths.ts';

test('source PDF is present and is a PDF', async () => {
  const head = (await readFile(SOURCE_PDF)).subarray(0, 8);
  expect(new TextDecoder().decode(head)).toBe('%PDF-1.7');
});

test('paths module exports absolute paths', () => {
  expect(APP_DIR.startsWith('/')).toBe(true);
});
```

`tests/e2e/smoke.spec.ts`:
```ts
import { test, expect } from '@playwright/test';

test('static server serves the compiled app shell', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('h1')).toHaveText('DSA5 Heldengenerator');
  await expect(page.locator('#status')).toHaveText('bereit');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx playwright test`
Expected: FAIL — cannot resolve `tools/paths.ts`; e2e fails because no server or shell exists.

- [ ] **Step 3: Write the scaffold**

`package.json`:
```json
{
  "name": "dsa5-heldengenerator",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24" },
  "scripts": {
    "build": "tsc -p tsconfig.app.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "serve": "node scripts/serve.ts",
    "dev": "npm run build && npm run serve",
    "test": "playwright test",
    "test:unit": "playwright test --project=unit",
    "test:e2e": "playwright test --project=e2e",
    "build:data": "node tools/pdf-js-extract.ts && node tools/build-data.ts"
  },
  "devDependencies": {
    "@playwright/test": "^1.62.1",
    "@types/node": "^24.0.0",
    "typescript": "^6.0.3"
  }
}
```

`tsconfig.json` (typecheck everything, emit nothing):
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "esnext",
    "moduleResolution": "bundler",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "types": ["node"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "allowImportingTsExtensions": true,
    "rewriteRelativeImportExtensions": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src", "tools", "scripts", "tests", "playwright.config.ts"]
}
```

`tsconfig.app.json` (emit browser bundle-free output):
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "types": [],
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "outDir": "app/js",
    "rootDir": "src",
    "noEmit": false,
    "declaration": false,
    "sourceMap": true
  },
  "include": ["src"]
}
```

Note: `types: []` in the app config keeps Node globals out of browser code — if `src/` ever imports `node:fs`, the app build fails, which is exactly the guard we want.

`tools/paths.ts`:
```ts
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export const ROOT: string = fileURLToPath(new URL('..', import.meta.url));
export const APP_DIR: string = join(ROOT, 'app');
export const DATA_DIR: string = join(APP_DIR, 'data');
export const BUILD_DIR: string = join(ROOT, 'build');
export const JS_DIR: string = join(BUILD_DIR, 'js');
export const SOURCE_PDF: string = join(
  ROOT,
  '423187-Charakterbogen_V2_13_(ausfuellbar_selbstrechnend_ohne_Hintergrund)_korr_V2.pdf',
);
```

`playwright.config.ts`:
```ts
import { defineConfig, devices } from '@playwright/test';

const PORT = 8173;

export default defineConfig({
  testDir: 'tests',
  fullyParallel: true,
  reporter: [['list']],
  projects: [
    { name: 'unit', testDir: './tests/unit' },
    {
      name: 'e2e',
      testDir: './tests/e2e',
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${PORT}` },
    },
  ],
  webServer: {
    command: 'npm run dev',
    port: PORT,
    reuseExistingServer: true,
    stdout: 'ignore',
  },
});
```

`scripts/serve.ts`:
```ts
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { APP_DIR } from '../tools/paths.ts';

const PORT = Number(process.env['PORT'] ?? 8173);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.pdf': 'application/pdf',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

http
  .createServer(async (req, res) => {
    try {
      const { pathname } = new URL(req.url ?? '/', 'http://localhost');
      let rel = normalize(decodeURIComponent(pathname));
      if (rel.endsWith('/')) rel += 'index.html';
      const file = join(APP_DIR, rel);
      if (!file.startsWith(APP_DIR)) {
        res.writeHead(403).end('forbidden');
        return;
      }
      const body = await readFile(file);
      res.writeHead(200, {
        'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
        'Content-Length': body.length,
      });
      res.end(body);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('not found');
    }
  })
  .listen(PORT, () => console.log(`serving app/ on http://localhost:${PORT}`));
```

`app/index.html` — loads the compiled entry point, proving the TS build wired up:
```html
<!doctype html>
<html lang="de">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>DSA5 Heldengenerator</title>
  </head>
  <body>
    <h1>DSA5 Heldengenerator</h1>
    <p id="status">lädt …</p>
    <script type="module" src="./js/main.js"></script>
  </body>
</html>
```

`src/main.ts` — the `export {}` is required, not decorative: without a top-level
import or export TypeScript treats the file as a script, and `const status` then
collides with the ambient DOM global `window.status` (`TS2451`). The file is loaded
as `<script type="module">`, so forcing module scope is correct anyway.
```ts
export {}; // force module scope; otherwise `status` collides with the DOM global

const status = document.querySelector<HTMLElement>('#status');
if (status) status.textContent = 'bereit';
```

`.gitignore`:
```
node_modules/
build/
app/js/
test-results/
playwright-report/
```

- [ ] **Step 4: Install, typecheck, build and run tests**

Run: `npm install && npm run typecheck && npm run build && npx playwright test`
Expected: typecheck clean; `app/js/main.js` emitted; PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tsconfig*.json playwright.config.ts scripts/ tools/paths.ts src/main.ts app/index.html .gitignore tests/
git commit -m "chore: scaffold TypeScript project, static server and Playwright harness"
```

---

### Task 2: PDF value types, lexer and object parser

**Files:**
- Create: `src/io/pdf-lexer.ts`
- Test: `tests/unit/pdf-lexer.spec.ts`

**Interfaces:**
- Consumes: nothing
- Produces the PDF value model every later task builds on:
```ts
export type PdfName = { readonly name: string };
export type PdfString = { readonly str: Uint8Array };
export type PdfRef = { readonly ref: number; readonly gen: number };
export type PdfKeyword = { readonly kw: string };
export type PdfDict = Map<string, PdfValue>;
export type PdfValue = number | boolean | null | PdfName | PdfString | PdfRef | PdfKeyword | PdfValue[] | PdfDict;
export type PdfStream = { readonly dict: PdfDict; readonly streamAt: number };
export type PdfObject = PdfValue | PdfStream;
```
- Type guards: `isDict`, `isRef`, `isName`, `isPdfString`, `isStream`, `isArray`
- `bytesFrom(text: string): Uint8Array`, `latin1(bytes: Uint8Array): string`
- `inflate(bytes: Uint8Array): Promise<Uint8Array>`
- `applyPredictor(data: Uint8Array, parms: PdfDict): Uint8Array`
- `class Parser { constructor(bytes: Uint8Array, pos?: number); ws(): void; token(): string | null; peek(): string | null; obj(): PdfValue; p: number }`

- [ ] **Step 1: Write the failing test**

`tests/unit/pdf-lexer.spec.ts`:
```ts
import { test, expect } from '@playwright/test';
import {
  Parser, bytesFrom, latin1, inflate, applyPredictor,
  isDict, isRef, isName, isPdfString,
} from '../../src/io/pdf-lexer.ts';
import type { PdfDict } from '../../src/io/pdf-lexer.ts';

const parse = (s: string) => new Parser(bytesFrom(s)).obj();
const asDict = (s: string): PdfDict => {
  const v = parse(s);
  if (!isDict(v)) throw new Error('expected dictionary');
  return v;
};
const asStr = (s: string): string => {
  const v = parse(s);
  if (!isPdfString(v)) throw new Error('expected string');
  return latin1(v.str);
};

test('parses numbers, booleans and null', () => {
  expect(parse('42')).toBe(42);
  expect(parse('-3.5')).toBe(-3.5);
  expect(parse('true')).toBe(true);
  expect(parse('null')).toBe(null);
});

test('parses names with hex escapes', () => {
  expect(parse('/Type')).toEqual({ name: 'Type' });
  expect(parse('/A#20B')).toEqual({ name: 'A B' });
});

test('parses literal strings with escapes and nesting', () => {
  expect(asStr('(hello)')).toBe('hello');
  expect(asStr('(a\\(b\\)c)')).toBe('a(b)c');
  expect(asStr('(nest (ed) ok)')).toBe('nest (ed) ok');
  expect(asStr('(tab\\tend)')).toBe('tab\tend');
  expect(asStr('(\\101)')).toBe('A');
});

test('parses hex strings, padding an odd final digit', () => {
  expect(asStr('<48656C6C6F>')).toBe('Hello');
  const v = parse('<4A5>');
  expect(isPdfString(v) && [...v.str]).toEqual([0x4a, 0x50]);
});

test('parses arrays and nested dictionaries', () => {
  expect(parse('[1 2 3]')).toEqual([1, 2, 3]);
  const d = asDict('<< /A 1 /B << /C /D >> >>');
  expect(d.get('A')).toBe(1);
  const inner = d.get('B');
  expect(isDict(inner) && inner.get('C')).toEqual({ name: 'D' });
});

test('distinguishes indirect references from adjacent integers', () => {
  expect(parse('12 0 R')).toEqual({ ref: 12, gen: 0 });
  expect(parse('[1 2]')).toEqual([1, 2]);
  const d = asDict('<< /Length 5 /Root 3 0 R >>');
  expect(d.get('Length')).toBe(5);
  expect(d.get('Root')).toEqual({ ref: 3, gen: 0 });
});

test('skips comments and whitespace', () => {
  expect(parse('% a comment\n  7')).toBe(7);
});

test('type guards narrow correctly', () => {
  expect(isName(parse('/X'))).toBe(true);
  expect(isRef(parse('1 0 R'))).toBe(true);
  expect(isDict(parse('<< >>'))).toBe(true);
  expect(isRef(parse('7'))).toBe(false);
});

test('inflate round-trips a compressed stream', async () => {
  const src = bytesFrom('the quick brown fox '.repeat(20));
  const packed = new Uint8Array(
    await new Response(
      new Blob([src]).stream().pipeThrough(new CompressionStream('deflate')),
    ).arrayBuffer(),
  );
  expect(latin1(await inflate(packed))).toBe(latin1(src));
});

test('applyPredictor reverses PNG Up filtering', () => {
  const data = new Uint8Array([2, 1, 2, 3, 2, 1, 1, 1]);
  const parms: PdfDict = new Map();
  parms.set('Predictor', 12);
  parms.set('Colors', 1);
  parms.set('BitsPerComponent', 8);
  parms.set('Columns', 3);
  expect([...applyPredictor(data, parms)]).toEqual([1, 2, 3, 2, 3, 4]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test --project=unit tests/unit/pdf-lexer.spec.ts`
Expected: FAIL — cannot resolve `src/io/pdf-lexer.ts`.

- [ ] **Step 3: Write the implementation**

`src/io/pdf-lexer.ts`:
```ts
export type PdfName = { readonly name: string };
export type PdfString = { readonly str: Uint8Array };
export type PdfRef = { readonly ref: number; readonly gen: number };
export type PdfKeyword = { readonly kw: string };
export type PdfDict = Map<string, PdfValue>;
export type PdfValue =
  | number | boolean | null
  | PdfName | PdfString | PdfRef | PdfKeyword
  | PdfValue[] | PdfDict;
export type PdfStream = { readonly dict: PdfDict; readonly streamAt: number };
export type PdfObject = PdfValue | PdfStream;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null;

export const isDict = (v: unknown): v is PdfDict => v instanceof Map;
export const isArray = (v: unknown): v is PdfValue[] => Array.isArray(v);
export const isName = (v: unknown): v is PdfName => isObj(v) && typeof v['name'] === 'string';
export const isPdfString = (v: unknown): v is PdfString => isObj(v) && v['str'] instanceof Uint8Array;
export const isRef = (v: unknown): v is PdfRef => isObj(v) && typeof v['ref'] === 'number';
export const isStream = (v: unknown): v is PdfStream =>
  isObj(v) && isDict(v['dict']) && typeof v['streamAt'] === 'number';

const LATIN1 = new TextDecoder('latin1');
export const latin1 = (bytes: Uint8Array): string => LATIN1.decode(bytes);

export function bytesFrom(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

export async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const run = async (format: 'deflate' | 'deflate-raw'): Promise<Uint8Array> => {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream(format));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  };
  try {
    return await run('deflate');
  } catch {
    return await run('deflate-raw');
  }
}

const WS = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIM = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);
const ESCAPES: Record<number, number> = { 0x6e: 10, 0x72: 13, 0x74: 9, 0x62: 8, 0x66: 12 };

export class Parser {
  readonly b: Uint8Array;
  p: number;

  constructor(bytes: Uint8Array, pos = 0) {
    this.b = bytes;
    this.p = pos;
  }

  private at(i: number): number {
    return this.b[i] ?? -1;
  }

  ws(): void {
    for (;;) {
      while (this.p < this.b.length && WS.has(this.at(this.p))) this.p++;
      if (this.at(this.p) !== 0x25) return;
      while (this.p < this.b.length && this.at(this.p) !== 0x0a && this.at(this.p) !== 0x0d) this.p++;
    }
  }

  token(): string | null {
    this.ws();
    if (this.p >= this.b.length) return null;
    const c = this.at(this.p);
    if (c === 0x3c && this.at(this.p + 1) === 0x3c) { this.p += 2; return '<<'; }
    if (c === 0x3e && this.at(this.p + 1) === 0x3e) { this.p += 2; return '>>'; }
    if (DELIM.has(c)) { this.p++; return String.fromCharCode(c); }
    const start = this.p;
    while (this.p < this.b.length && !WS.has(this.at(this.p)) && !DELIM.has(this.at(this.p))) this.p++;
    return latin1(this.b.subarray(start, this.p));
  }

  peek(): string | null {
    const save = this.p;
    const t = this.token();
    this.p = save;
    return t;
  }

  private name(): string {
    let s = '';
    while (this.p < this.b.length && !WS.has(this.at(this.p)) && !DELIM.has(this.at(this.p))) {
      let ch = this.at(this.p++);
      if (ch === 0x23) {
        ch = parseInt(latin1(this.b.subarray(this.p, this.p + 2)), 16);
        this.p += 2;
      }
      s += String.fromCharCode(ch);
    }
    return s;
  }

  private literalString(): PdfString {
    let depth = 1;
    const out: number[] = [];
    this.p++;
    while (this.p < this.b.length) {
      const c = this.at(this.p++);
      if (c === 0x5c) {
        const n = this.at(this.p++);
        const mapped = ESCAPES[n];
        if (mapped !== undefined) out.push(mapped);
        else if (n >= 0x30 && n <= 0x37) {
          let oct = String.fromCharCode(n);
          for (let k = 0; k < 2 && this.at(this.p) >= 0x30 && this.at(this.p) <= 0x37; k++) {
            oct += String.fromCharCode(this.at(this.p++));
          }
          out.push(parseInt(oct, 8) & 0xff);
        } else if (n === 0x0a) { /* line continuation */ }
        else if (n === 0x0d) { if (this.at(this.p) === 0x0a) this.p++; }
        else out.push(n);
      } else if (c === 0x28) { depth++; out.push(c); }
      else if (c === 0x29) { if (--depth === 0) break; out.push(c); }
      else out.push(c);
    }
    return { str: new Uint8Array(out) };
  }

  private hexString(): PdfString {
    this.p++;
    let hex = '';
    while (this.p < this.b.length && this.at(this.p) !== 0x3e) {
      const c = this.at(this.p++);
      if (!WS.has(c)) hex += String.fromCharCode(c);
    }
    this.p++;
    if (hex.length % 2) hex += '0';
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return { str: out };
  }

  obj(): PdfValue {
    this.ws();
    const c = this.at(this.p);
    if (c === 0x2f) { this.p++; return { name: this.name() }; }
    if (c === 0x28) return this.literalString();
    if (c === 0x3c && this.at(this.p + 1) !== 0x3c) return this.hexString();
    if (c === 0x5b) {
      this.p++;
      const arr: PdfValue[] = [];
      for (;;) {
        this.ws();
        if (this.p >= this.b.length || this.at(this.p) === 0x5d) { this.p++; break; }
        arr.push(this.obj());
      }
      return arr;
    }
    if (c === 0x3c && this.at(this.p + 1) === 0x3c) {
      this.p += 2;
      const dict: PdfDict = new Map();
      for (;;) {
        this.ws();
        if (this.p >= this.b.length) break;
        if (this.at(this.p) === 0x3e && this.at(this.p + 1) === 0x3e) { this.p += 2; break; }
        if (this.at(this.p) !== 0x2f) { this.token(); continue; }
        this.p++;
        dict.set(this.name(), this.obj());
      }
      return dict;
    }
    const t = this.token();
    if (t === null) return null;
    if (t === 'true') return true;
    if (t === 'false') return false;
    if (t === 'null') return null;
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(t)) {
      const save = this.p;
      const t2 = this.token();
      if (t2 !== null && /^\d+$/.test(t2) && this.token() === 'R') {
        return { ref: parseInt(t, 10), gen: parseInt(t2, 10) };
      }
      this.p = save;
      return parseFloat(t);
    }
    return { kw: t };
  }
}

export function applyPredictor(data: Uint8Array, parms: PdfDict): Uint8Array {
  const numeric = (key: string, fallback: number): number => {
    const v = parms.get(key);
    return typeof v === 'number' ? v : fallback;
  };
  const predictor = numeric('Predictor', 1);
  if (predictor < 2) return data;
  if (predictor === 2) return data;

  const colors = numeric('Colors', 1);
  const bpc = numeric('BitsPerComponent', 8);
  const columns = numeric('Columns', 1);
  const bpp = Math.ceil((colors * bpc) / 8);
  const rowLen = Math.ceil((colors * bpc * columns) / 8);
  const rows = Math.floor(data.length / (rowLen + 1));
  const out = new Uint8Array(rows * rowLen);
  let prev = new Uint8Array(rowLen);

  for (let r = 0; r < rows; r++) {
    const base = r * (rowLen + 1);
    const filter = data[base] ?? 0;
    const row = data.subarray(base + 1, base + 1 + rowLen);
    const cur = new Uint8Array(rowLen);
    for (let i = 0; i < rowLen; i++) {
      const a = i >= bpp ? (cur[i - bpp] ?? 0) : 0;
      const b = prev[i] ?? 0;
      const c = i >= bpp ? (prev[i - bpp] ?? 0) : 0;
      const x = row[i] ?? 0;
      let v: number;
      switch (filter) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: v = x;
      }
      cur[i] = v & 0xff;
    }
    out.set(cur, r * rowLen);
    prev = cur;
  }
  return out;
}
```

- [ ] **Step 4: Run test and typecheck**

Run: `npx playwright test --project=unit tests/unit/pdf-lexer.spec.ts && npm run typecheck`
Expected: PASS — 10 tests; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/io/pdf-lexer.ts tests/unit/pdf-lexer.spec.ts
git commit -m "feat(pdf): typed value model, lexer, inflate and PNG predictors"
```

---

### Task 3: PDF document layer — xref, object streams, resolution

**Files:**
- Create: `src/io/pdf-document.ts`
- Test: `tests/unit/pdf-document.spec.ts`

**Interfaces:**
- Consumes: everything exported by `src/io/pdf-lexer.ts`
- Produces:
```ts
export type XrefEntry = { type: 1; offset: number } | { type: 2; stm: number; idx: number };
export class PDFDoc {
  readonly bytes: Uint8Array;
  readonly index: Map<number, XrefEntry>;
  readonly trailer: PdfDict;
  static load(bytes: Uint8Array): Promise<PDFDoc>;
  get(num: number): Promise<PdfObject | null>;
  resolve(value: PdfObject | undefined): Promise<PdfObject | null>;
  resolveDict(value: PdfObject | undefined): Promise<PdfDict | null>;
  streamData(stream: PdfStream): Promise<Uint8Array>;
  startxrefOffsets(): number[];
}
```

**`/Prev` chain rule:** the newest xref section wins. Never overwrite an object number or trailer key already recorded.

- [ ] **Step 1: Write the failing test**

`tests/unit/pdf-document.spec.ts`:
```ts
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PDFDoc } from '../../src/io/pdf-document.ts';
import { isDict } from '../../src/io/pdf-lexer.ts';
import { SOURCE_PDF } from '../../tools/paths.ts';

let doc: PDFDoc;
test.beforeAll(async () => {
  doc = await PDFDoc.load(new Uint8Array(await readFile(SOURCE_PDF)));
});

test('indexes every object in the cross-reference streams', () => {
  expect(doc.index.size).toBe(17151);
});

test('reads the trailer and resolves the catalog', async () => {
  const root = await doc.resolveDict(doc.trailer.get('Root'));
  expect(root).not.toBeNull();
  expect(root!.get('Type')).toEqual({ name: 'Catalog' });
  expect([...root!.keys()].sort()).toEqual(
    ['AcroForm', 'Metadata', 'Names', 'OCProperties', 'Outlines', 'PageMode', 'Pages', 'Type'].sort(),
  );
});

test('resolves objects stored inside object streams', async () => {
  const compressed = [...doc.index.entries()].filter(([, e]) => e.type === 2);
  expect(compressed.length).toBeGreaterThan(1000);
  const first = compressed[0];
  expect(first).toBeDefined();
  expect(await doc.get(first![0])).not.toBeNull();
});

test('decodes streams through Flate and predictors', async () => {
  const root = await doc.resolveDict(doc.trailer.get('Root'));
  const names = await doc.resolveDict(root!.get('Names'));
  expect(names!.has('JavaScript')).toBe(true);
});

test('document has 10 pages', async () => {
  const root = await doc.resolveDict(doc.trailer.get('Root'));
  const pages = await doc.resolveDict(root!.get('Pages'));
  expect(pages!.get('Count')).toBe(10);
});

test('startxrefOffsets finds the trailing pointer', () => {
  const offsets = doc.startxrefOffsets();
  expect(offsets.length).toBeGreaterThan(0);
  expect(offsets.at(-1)).toBeGreaterThan(0);
});

test('resolveDict returns null for non-dictionaries', async () => {
  expect(await doc.resolveDict(42)).toBeNull();
  expect(isDict(await doc.resolveDict(doc.trailer.get('Root')))).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test --project=unit tests/unit/pdf-document.spec.ts`
Expected: FAIL — cannot resolve `src/io/pdf-document.ts`.

- [ ] **Step 3: Write the implementation**

`src/io/pdf-document.ts`:
```ts
import { Parser, inflate, applyPredictor, latin1, isDict, isRef, isName, isArray, isStream } from './pdf-lexer.ts';
import type { PdfDict, PdfObject, PdfStream, PdfValue } from './pdf-lexer.ts';

export type XrefEntry = { type: 1; offset: number } | { type: 2; stm: number; idx: number };

export class PDFDoc {
  readonly bytes: Uint8Array;
  readonly index = new Map<number, XrefEntry>();
  readonly trailer: PdfDict = new Map();
  private readonly cache = new Map<number, PdfObject | null>();
  private readonly objStmCache = new Map<number, Map<number, PdfValue>>();

  private constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  static async load(bytes: Uint8Array): Promise<PDFDoc> {
    const doc = new PDFDoc(bytes);
    await doc.parseXrefChain();
    return doc;
  }

  startxrefOffsets(): number[] {
    const tail = latin1(this.bytes.subarray(Math.max(0, this.bytes.length - 2048)));
    return [...tail.matchAll(/startxref\s+(\d+)/g)].map((m) => parseInt(m[1] ?? '0', 10));
  }

  private async parseXrefChain(): Promise<void> {
    const offsets = this.startxrefOffsets();
    const last = offsets.at(-1);
    if (last === undefined) throw new Error('no startxref found');
    let next: number | undefined = last;
    const seen = new Set<number>();
    while (next !== undefined && !seen.has(next)) {
      seen.add(next);
      next = await this.parseXrefSection(next);
    }
  }

  private mergeTrailer(dict: PdfDict): void {
    for (const [k, v] of dict) if (!this.trailer.has(k)) this.trailer.set(k, v);
  }

  private async parseXrefSection(offset: number): Promise<number | undefined> {
    const p = new Parser(this.bytes, offset);
    return p.peek() === 'xref' ? await this.parseXrefTable(p) : await this.parseXrefStream(p);
  }

  private async parseXrefTable(p: Parser): Promise<number | undefined> {
    p.token();
    for (;;) {
      if (p.peek() === 'trailer') { p.token(); break; }
      const first = parseInt(p.token() ?? '', 10);
      const count = parseInt(p.token() ?? '', 10);
      if (Number.isNaN(first) || Number.isNaN(count)) break;
      p.ws();
      for (let i = 0; i < count; i++) {
        const entry = latin1(this.bytes.subarray(p.p, p.p + 20));
        p.p += 20;
        const m = /^\s*(\d{10})\s(\d{5})\s([nf])/.exec(entry);
        if (!m) continue;
        const num = first + i;
        if (m[3] === 'n' && !this.index.has(num)) {
          this.index.set(num, { type: 1, offset: parseInt(m[1] ?? '0', 10) });
        }
      }
    }
    const trailer = p.obj();
    if (!isDict(trailer)) return undefined;
    this.mergeTrailer(trailer);
    const hybrid = trailer.get('XRefStm');
    if (typeof hybrid === 'number') await this.parseXrefSection(hybrid);
    const prev = trailer.get('Prev');
    return typeof prev === 'number' ? prev : undefined;
  }

  private async parseXrefStream(p: Parser): Promise<number | undefined> {
    p.token(); p.token(); p.token();
    const dict = p.obj();
    if (!isDict(dict)) throw new Error('xref stream is not a dictionary');
    const data = await this.readStream(p, dict);

    const w = dict.get('W');
    if (!isArray(w)) throw new Error('xref stream missing /W');
    const [w0, w1, w2] = w.map((x) => (typeof x === 'number' ? x : 0));
    const size = dict.get('Size');
    const indexRaw = dict.get('Index');
    const index = isArray(indexRaw)
      ? indexRaw.map((x) => (typeof x === 'number' ? x : 0))
      : [0, typeof size === 'number' ? size : 0];

    let pos = 0;
    const readField = (width: number, fallback: number): number => {
      if (width === 0) return fallback;
      let v = 0;
      for (let i = 0; i < width; i++) v = v * 256 + (data[pos++] ?? 0);
      return v;
    };

    for (let s = 0; s < index.length; s += 2) {
      const first = index[s] ?? 0;
      const count = index[s + 1] ?? 0;
      for (let i = 0; i < count; i++) {
        const type = readField(w0 ?? 1, 1);
        const f2 = readField(w1 ?? 0, 0);
        const f3 = readField(w2 ?? 0, 0);
        const num = first + i;
        if (this.index.has(num)) continue;
        if (type === 1) this.index.set(num, { type: 1, offset: f2 });
        else if (type === 2) this.index.set(num, { type: 2, stm: f2, idx: f3 });
      }
    }
    this.mergeTrailer(dict);
    const prev = dict.get('Prev');
    return typeof prev === 'number' ? prev : undefined;
  }

  private async readStream(p: Parser, dict: PdfDict): Promise<Uint8Array> {
    const kw = p.token();
    if (kw !== 'stream') throw new Error(`expected 'stream', got '${kw}'`);
    if (this.bytes[p.p] === 0x0d) p.p++;
    if (this.bytes[p.p] === 0x0a) p.p++;
    let length = dict.get('Length');
    if (isRef(length)) length = (await this.get(length.ref)) as PdfValue;
    if (typeof length !== 'number') throw new Error('stream has no usable /Length');
    return await this.decode(dict, this.bytes.subarray(p.p, p.p + length));
  }

  private async decode(dict: PdfDict, raw: Uint8Array): Promise<Uint8Array> {
    const filterRaw = dict.get('Filter');
    if (filterRaw === undefined || filterRaw === null) return raw;
    const filters = isArray(filterRaw) ? filterRaw : [filterRaw];
    let data = raw;
    for (const f of filters) {
      const name = isName(f) ? f.name : String(f);
      if (name !== 'FlateDecode') throw new Error(`unsupported stream filter: ${name}`);
      data = await inflate(data);
    }
    let parms = dict.get('DecodeParms');
    if (isArray(parms)) parms = parms.find(isDict) ?? null;
    if (isDict(parms)) data = applyPredictor(data, parms);
    return data;
  }

  async streamData(stream: PdfStream): Promise<Uint8Array> {
    return await this.readStream(new Parser(this.bytes, stream.streamAt), stream.dict);
  }

  async get(num: number): Promise<PdfObject | null> {
    const cached = this.cache.get(num);
    if (cached !== undefined) return cached;
    const entry = this.index.get(num);
    if (!entry) return null;

    let value: PdfObject | null = null;
    if (entry.type === 1) {
      const p = new Parser(this.bytes, entry.offset);
      p.token(); p.token();
      if (p.token() === 'obj') {
        const parsed = p.obj();
        const save = p.p;
        if (p.token() === 'stream' && isDict(parsed)) {
          value = { dict: parsed, streamAt: save };
        } else {
          value = parsed;
        }
      }
    } else {
      value = (await this.loadObjStm(entry.stm)).get(num) ?? null;
    }
    this.cache.set(num, value);
    return value;
  }

  private async loadObjStm(stmNum: number): Promise<Map<number, PdfValue>> {
    const cached = this.objStmCache.get(stmNum);
    if (cached) return cached;
    const entry = this.index.get(stmNum);
    if (!entry || entry.type !== 1) throw new Error(`object stream ${stmNum} not found`);

    const p = new Parser(this.bytes, entry.offset);
    p.token(); p.token(); p.token();
    const dict = p.obj();
    if (!isDict(dict)) throw new Error('object stream is not a dictionary');
    const data = await this.readStream(p, dict);
    const count = dict.get('N');
    const first = dict.get('First');
    if (typeof count !== 'number' || typeof first !== 'number') {
      throw new Error('object stream missing /N or /First');
    }

    const header = new Parser(data, 0);
    const pairs: Array<[number, number]> = [];
    for (let i = 0; i < count; i++) {
      pairs.push([parseInt(header.token() ?? '', 10), parseInt(header.token() ?? '', 10)]);
    }
    const map = new Map<number, PdfValue>();
    for (const [num, off] of pairs) map.set(num, new Parser(data, first + off).obj());
    this.objStmCache.set(stmNum, map);
    return map;
  }

  async resolve(value: PdfObject | undefined): Promise<PdfObject | null> {
    let v: PdfObject | null = value ?? null;
    let guard = 0;
    while (isRef(v)) {
      if (++guard > 64) throw new Error('reference cycle');
      v = await this.get(v.ref);
    }
    return v;
  }

  async resolveDict(value: PdfObject | undefined): Promise<PdfDict | null> {
    const v = await this.resolve(value);
    if (isDict(v)) return v;
    if (isStream(v)) return v.dict;
    return null;
  }
}
```

Guards are **not** re-exported here — consumers import them from `pdf-lexer.ts` directly, so there is exactly one import path per symbol.

- [ ] **Step 4: Run test and typecheck**

Run: `npx playwright test --project=unit tests/unit/pdf-document.spec.ts && npm run typecheck`
Expected: PASS — 7 tests, load well under a second.

- [ ] **Step 5: Commit**

```bash
git add src/io/pdf-document.ts tests/unit/pdf-document.spec.ts
git commit -m "feat(pdf): xref chain, object streams and typed object resolution"
```

---

### Task 4: AcroForm field walk

**Files:**
- Create: `src/io/pdf-acroform.ts`
- Test: `tests/unit/pdf-acroform.spec.ts`

**Interfaces:**
- Consumes: `PDFDoc`, the lexer type guards
- Produces:
```ts
export type Widget = { readonly ref: number | null; readonly dict: PdfDict };
export type FieldInfo = {
  readonly name: string;
  readonly ref: number | null;
  readonly dict: PdfDict;
  readonly type: string | null;
  readonly widgets: readonly Widget[];
};
export function readAcroFields(doc: PDFDoc): Promise<Map<string, FieldInfo>>;
export function fieldValue(doc: PDFDoc, field: FieldInfo | undefined): Promise<string>;
export function decodeText(bytes: Uint8Array): string;
```

**Structure, established by measurement against this exact PDF:**

| Measurement | Value |
|---|---:|
| named nodes in the field tree (all `/T` nodes) | 5970 |
| **terminal fields** (no named kids) | **5442** |
| terminal fields lacking their own `/FT` | **0** |
| non-terminal nodes carrying their own `/FT` | **0** |

So `has('FT')` and "is terminal" coincide exactly, and **no `/FT` inheritance occurs
anywhere in this document**. The 528-node difference is pure container nodes such as
`AEAnzeige` and `AEAnzeige.RTF`, whose real fields are the leaves below them
(`AEAnzeige.FontSize`, `AEAnzeige.RTF.FontSize`). Containers are **not** fillable and
must stay out of the map — including them would feed 528 non-fields to Plan 3's writer.
422 terminal fields have dotted names, so the walk must still descend through containers
and build qualified names.

Widgets are kids **without** `/T`; a field with no such kids is its own widget. `MU_1`
must report exactly **6 widgets** — Plan 3's appearance-stream writer depends on this,
because writing `/AP` on the field alone leaves six stale appearances that print the
old value.

- [ ] **Step 1: Write the failing test**

`tests/unit/pdf-acroform.spec.ts`:
```ts
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PDFDoc } from '../../src/io/pdf-document.ts';
import { readAcroFields, fieldValue, decodeText } from '../../src/io/pdf-acroform.ts';
import { isPdfString, isArray } from '../../src/io/pdf-lexer.ts';
import type { FieldInfo } from '../../src/io/pdf-acroform.ts';
import { SOURCE_PDF } from '../../tools/paths.ts';

let doc: PDFDoc;
let fields: Map<string, FieldInfo>;
test.beforeAll(async () => {
  doc = await PDFDoc.load(new Uint8Array(await readFile(SOURCE_PDF)));
  fields = await readAcroFields(doc);
});

test('finds every terminal field, and only terminal fields', () => {
  expect(fields.size).toBe(5442);
});

test('MU_1 carries six widgets, each with its own appearance', () => {
  const mu = fields.get('MU_1');
  expect(mu).toBeDefined();
  expect(mu!.type).toBe('Tx');
  expect(mu!.widgets.length).toBe(6);
  for (const w of mu!.widgets) expect(w.dict.has('AP')).toBe(true);
});

test('a field without kids is its own widget', () => {
  const held = fields.get('Held_Name');
  expect(held!.widgets.length).toBe(1);
  expect(held!.widgets[0]!.ref).toBe(held!.ref);
});

test('container nodes are excluded, their leaf fields are kept', () => {
  // AEAnzeige and AEAnzeige.RTF are grouping nodes with no /FT - not fillable.
  expect(fields.has('AEAnzeige')).toBe(false);
  expect(fields.has('AEAnzeige.RTF')).toBe(false);
  // The real fields are the leaves below them, reached through qualified names.
  expect(fields.has('AEAnzeige.FontSize')).toBe(true);
  expect(fields.has('AEAnzeige.RTF.FontSize')).toBe(true);
});

test('every terminal field carries its own /FT (no inheritance in this document)', () => {
  for (const field of fields.values()) expect(field.dict.has('FT'), field.name).toBe(true);
});

test('the walk descends through containers to build qualified names', () => {
  const dotted = [...fields.keys()].filter((n) => n.includes('.'));
  expect(dotted.length).toBe(422);
});

test('exposes the display attributes the writer needs', () => {
  const mu = fields.get('MU_1')!;
  const da = mu.dict.get('DA');
  expect(isPdfString(da) && decodeText(da.str)).toContain('Tf');
  expect(mu.dict.get('Q')).toBe(1);
  const rect = mu.widgets[0]!.dict.get('Rect');
  expect(isArray(rect) && rect.length).toBe(4);
});

test('reads values of the unfilled template as empty', async () => {
  expect(await fieldValue(doc, fields.get('Held_Name'))).toBe('');
});

test('decodeText handles UTF-16BE with BOM and latin1', () => {
  expect(decodeText(new Uint8Array([0xfe, 0xff, 0x00, 0x41, 0x00, 0x42]))).toBe('AB');
  expect(decodeText(new Uint8Array([0x41, 0x42]))).toBe('AB');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test --project=unit tests/unit/pdf-acroform.spec.ts`
Expected: FAIL — cannot resolve `src/io/pdf-acroform.ts`.

- [ ] **Step 3: Write the implementation**

`src/io/pdf-acroform.ts`:
```ts
import { latin1, isDict, isArray, isName, isPdfString } from './pdf-lexer.ts';
import type { PdfDict, PdfObject, PdfValue } from './pdf-lexer.ts';
import type { PDFDoc } from './pdf-document.ts';

export type Widget = { readonly ref: number | null; readonly dict: PdfDict };

export type FieldInfo = {
  readonly name: string;
  readonly ref: number | null;
  readonly dict: PdfDict;
  readonly type: string | null;
  readonly widgets: readonly Widget[];
};

const UTF16BE = new TextDecoder('utf-16be');

export function decodeText(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return UTF16BE.decode(bytes.subarray(2));
  }
  return latin1(bytes);
}

const refOf = (value: PdfValue): number | null =>
  typeof value === 'object' && value !== null && 'ref' in value
    ? (value as { ref: number }).ref
    : null;

export async function readAcroFields(doc: PDFDoc): Promise<Map<string, FieldInfo>> {
  const root = await doc.resolveDict(doc.trailer.get('Root'));
  if (!root) throw new Error('document has no catalog');
  const acroForm = await doc.resolveDict(root.get('AcroForm'));
  if (!acroForm) throw new Error('document has no AcroForm');
  const rootsRaw = await doc.resolve(acroForm.get('Fields'));
  const roots: PdfValue[] = isArray(rootsRaw) ? rootsRaw : [];

  const out = new Map<string, FieldInfo>();

  const walk = async (reference: PdfValue, prefix: string): Promise<void> => {
    const dict = await doc.resolveDict(reference as PdfObject);
    if (!dict) return;

    const titleRaw = dict.get('T');
    const title = isPdfString(titleRaw) ? decodeText(titleRaw.str) : null;
    const name = title === null ? prefix : prefix ? `${prefix}.${title}` : title;

    const kidsRaw = await doc.resolve(dict.get('Kids'));
    const kids: PdfValue[] = isArray(kidsRaw) ? kidsRaw : [];

    const resolved: Array<{ reference: PdfValue; dict: PdfDict }> = [];
    for (const kid of kids) {
      const kidDict = await doc.resolveDict(kid as PdfObject);
      if (kidDict) resolved.push({ reference: kid, dict: kidDict });
    }
    const namedKids = resolved.filter((k) => k.dict.has('T'));
    const widgetKids = resolved.filter((k) => !k.dict.has('T'));

    // A node with /T and /FT is a field even if it also has named kids.
    if (title !== null && dict.has('FT')) {
      const ft = dict.get('FT');
      const widgets: Widget[] = widgetKids.length
        ? widgetKids.map((k) => ({ ref: refOf(k.reference), dict: k.dict }))
        : [{ ref: refOf(reference), dict }];
      out.set(name, {
        name,
        ref: refOf(reference),
        dict,
        type: isName(ft) ? ft.name : null,
        widgets,
      });
    }

    for (const kid of namedKids) await walk(kid.reference, name);
  };

  for (const field of roots) await walk(field, '');
  return out;
}

export async function fieldValue(doc: PDFDoc, field: FieldInfo | undefined): Promise<string> {
  if (!field) return '';
  const v = await doc.resolve(field.dict.get('V'));
  if (v === null || v === undefined) return '';
  if (isPdfString(v)) return decodeText(v.str);
  if (isName(v)) return v.name;
  if (typeof v === 'number') return String(v);
  if (isDict(v)) return '';
  return '';
}
```

- [ ] **Step 4: Run test and typecheck**

Run: `npx playwright test --project=unit tests/unit/pdf-acroform.spec.ts && npm run typecheck`
Expected: PASS — 9 tests. If `fields.size` is not exactly 5442, the walk drops or duplicates nodes; fix the walk, never the expected number. In particular, do **not** relax the `has('FT')` guard to reach a higher count — that admits 528 container nodes.

- [ ] **Step 5: Commit**

```bash
git add src/io/pdf-acroform.ts tests/unit/pdf-acroform.spec.ts
git commit -m "feat(pdf): AcroForm field walk with widget resolution"
```

---

### Task 5: Extract the embedded JavaScript

**Files:**
- Create: `tools/pdf-js-extract.ts`
- Test: `tests/unit/js-extract.spec.ts`

**Interfaces:**
- Consumes: `PDFDoc`, `tools/paths.ts`
- Produces: `export function extractJavaScript(doc: PDFDoc): Promise<Map<string, string>>` — function name → source. Run as a script it writes `build/js/<name>.js` and prints a count.

**Encoding, established by measurement:** the 797 streams are mixed — 383 decode as UTF-8, 373 as CP1252, 41 as neither. Order matters: BOM, then strict UTF-8, then windows-1252, then latin1. A wrong order silently mangles every umlaut, and umlauts are load-bearing (`Körper`, `Zähigkeit`, `Größe`, `Legendär`).

- [ ] **Step 1: Write the failing test**

`tests/unit/js-extract.spec.ts`:
```ts
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PDFDoc } from '../../src/io/pdf-document.ts';
import { extractJavaScript } from '../../tools/pdf-js-extract.ts';
import { SOURCE_PDF } from '../../tools/paths.ts';

let scripts: Map<string, string>;
test.beforeAll(async () => {
  const doc = await PDFDoc.load(new Uint8Array(await readFile(SOURCE_PDF)));
  scripts = await extractJavaScript(doc);
});

test('extracts every document-level script', () => {
  expect(scripts.size).toBe(797);
});

test('includes the lookup functions the data build depends on', () => {
  for (const name of [
    'TalentGetInfo', 'SpeziesGetInfo', 'KulturGetInfo', 'ProfessionGetInfo',
    'VorteilGetInfo', 'NachteilGetInfo', 'ZauberGetInfo', 'LiturgieGetInfo',
    'KampftechnikGetInfo', 'ErfahrungsgradGetInfo',
    'EigenschaftAPRechner', 'TalentKosten', 'EnergieKosten', 'SpaltenFaktor',
  ]) {
    expect(scripts.has(name), `missing ${name}`).toBe(true);
  }
});

test('decodes umlauts correctly across all encodings', () => {
  expect(scripts.get('TalentGetInfo')).toContain('Körper');
  expect(scripts.get('TalentGetInfo')).toContain('Loyalität');
  expect(scripts.get('SpeziesGetInfo')).toContain('Größe');
  expect(scripts.get('ErfahrungsgradGetInfo')).toContain('Legendär');
});

test('no script contains the Unicode replacement character', () => {
  const broken = [...scripts].filter(([, src]) => src.includes('�')).map(([n]) => n);
  expect(broken).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test --project=unit tests/unit/js-extract.spec.ts`
Expected: FAIL — cannot resolve `tools/pdf-js-extract.ts`.

- [ ] **Step 3: Write the implementation**

`tools/pdf-js-extract.ts`:
```ts
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { PDFDoc } from '../src/io/pdf-document.ts';
import { latin1, isArray, isPdfString, isStream, isRef } from '../src/io/pdf-lexer.ts';
import type { PdfObject, PdfValue } from '../src/io/pdf-lexer.ts';
import { SOURCE_PDF, JS_DIR } from './paths.ts';

export function decodeSource(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    /* not valid UTF-8 */
  }
  const cp1252 = new TextDecoder('windows-1252').decode(bytes);
  if (!cp1252.includes('�')) return cp1252;
  return latin1(bytes);
}

async function jsBytes(doc: PDFDoc, entry: PdfValue): Promise<Uint8Array | null> {
  if (isRef(entry)) return await jsBytes(doc, (await doc.get(entry.ref)) as PdfValue);
  if (isPdfString(entry)) return entry.str;
  if (isStream(entry)) return await doc.streamData(entry);
  return null;
}

async function collect(doc: PDFDoc, node: PdfObject | undefined, out: Map<string, string>): Promise<void> {
  const dict = await doc.resolveDict(node);
  if (!dict) return;

  const names = await doc.resolve(dict.get('Names'));
  if (isArray(names)) {
    for (let i = 0; i < names.length; i += 2) {
      const keyRaw = await doc.resolve(names[i] as PdfObject);
      const actionDict = await doc.resolveDict(names[i + 1] as PdfObject);
      if (!isPdfString(keyRaw) || !actionDict) continue;
      const jsEntry = actionDict.get('JS');
      if (jsEntry === undefined) continue;
      const bytes = await jsBytes(doc, jsEntry);
      if (!bytes) continue;
      out.set(decodeSource(keyRaw.str), decodeSource(bytes));
    }
  }

  const kids = await doc.resolve(dict.get('Kids'));
  if (isArray(kids)) for (const kid of kids) await collect(doc, kid as PdfObject, out);
}

export async function extractJavaScript(doc: PDFDoc): Promise<Map<string, string>> {
  const root = await doc.resolveDict(doc.trailer.get('Root'));
  if (!root) throw new Error('document has no catalog');
  const names = await doc.resolveDict(root.get('Names'));
  if (!names) throw new Error('document has no name tree');
  const tree = names.get('JavaScript');
  if (tree === undefined) throw new Error('document has no JavaScript name tree');
  const out = new Map<string, string>();
  await collect(doc, tree, out);
  return out;
}

async function main(): Promise<void> {
  const doc = await PDFDoc.load(new Uint8Array(await readFile(SOURCE_PDF)));
  const scripts = await extractJavaScript(doc);
  await rm(JS_DIR, { recursive: true, force: true });
  await mkdir(JS_DIR, { recursive: true });
  for (const [name, source] of scripts) {
    const safe = name.replace(/[^A-Za-z0-9._-]/g, '_');
    await writeFile(join(JS_DIR, `${safe}.js`), source, 'utf8');
  }
  console.log(`extracted ${scripts.size} scripts to ${JS_DIR}`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
```

- [ ] **Step 4: Run test, then extract for real**

Run: `npx playwright test --project=unit tests/unit/js-extract.spec.ts && node tools/pdf-js-extract.ts && npm run typecheck`
Expected: PASS — 4 tests; prints `extracted 797 scripts to .../build/js`.

- [ ] **Step 5: Commit**

```bash
git add tools/pdf-js-extract.ts tests/unit/js-extract.spec.ts
git commit -m "feat(tools): extract embedded Acrobat JavaScript with encoding detection"
```

---

### Task 6: Acrobat shim and dataset build

**Files:**
- Create: `tools/acrobat-shim.ts`, `tools/build-data.ts`
- Test: `tests/unit/build-data.spec.ts`

**Interfaces:**
- Consumes: `build/js/*.js` (Task 5), `tools/paths.ts`
- Produces:
```ts
// tools/acrobat-shim.ts
export type RulesContext = {
  readonly failed: ReadonlyArray<{ file: string; message: string }>;
  call(fnName: string, ...args: Array<string | number>): unknown;
};
export function createRulesContext(scriptDir: string): RulesContext;

// tools/build-data.ts
export type DatasetSpec = {
  key: string; fn: string; count: number; fields: readonly string[]; zeroBased?: boolean;
};
export const DATASETS: readonly DatasetSpec[];
export function buildDataset(ctx: RulesContext, spec: DatasetSpec): Array<Record<string, unknown>>;
```

**Two traps, both hit during research — the code guards against them:**
1. `*GetInfo` returns a **fallback number** (the collection size) for an unknown info key. `VorteilGetInfo(id,'AP')` returns `234`, not an error. Cost lives under `BasisKosten`. Every value is checked against the fallback and dropped if it matches.
2. Nachteil costs are stored **negative** (`NT65 = -30`). Never negate them again when summing.

- [ ] **Step 1: Write the failing test**

`tests/unit/build-data.spec.ts`:
```ts
import { test, expect } from '@playwright/test';
import { createRulesContext } from '../../tools/acrobat-shim.ts';
import { buildDataset, DATASETS } from '../../tools/build-data.ts';
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test --project=unit tests/unit/build-data.spec.ts`
Expected: FAIL — cannot resolve `tools/acrobat-shim.ts`.

- [ ] **Step 3: Write the implementation**

`tools/acrobat-shim.ts`:
```ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

export type RulesContext = {
  readonly failed: ReadonlyArray<{ file: string; message: string }>;
  call(fnName: string, ...args: Array<string | number>): unknown;
};

/**
 * Builds a vm context with every extracted Acrobat function loaded.
 * The document JS expects an Acrobat host (`this.getField`, `app`, `util`, `event`).
 * The `*GetInfo` lookup functions never depend on real field values, so an inert stub
 * suffices; purely UI functions fail to load and are simply never called.
 */
export function createRulesContext(scriptDir: string): RulesContext {
  const field = {
    value: '',
    valueAsString: '',
    numItems: 0,
    display: 0,
    getItemAt: () => '',
    buttonGetCaption: () => '',
    setAction() {},
    setItems() {},
    clearItems() {},
  };

  const sandbox: Record<string, unknown> = {
    console, JSON, Math, Date,
    parseInt, parseFloat, String, Number, Array, Object, RegExp, isNaN,
    app: { alert() {}, popUpMenu: () => null },
    util: { printf: (...a: unknown[]) => a.join(''), printd: () => '' },
    event: {},
    color: {},
    display: { visible: 0, hidden: 1 },
  };
  sandbox['this'] = {
    getField: () => field,
    numFields: 0,
    getNthFieldName: () => '',
    calculate: false,
    calculateNow() {},
  };
  sandbox['globalThis'] = sandbox;

  const context = vm.createContext(sandbox);
  const failed: Array<{ file: string; message: string }> = [];

  for (const file of readdirSync(scriptDir)) {
    if (!file.endsWith('.js')) continue;
    try {
      vm.runInContext(readFileSync(join(scriptDir, file), 'utf8'), context, { filename: file });
    } catch (error) {
      failed.push({ file, message: error instanceof Error ? error.message : String(error) });
    }
  }

  return {
    failed,
    call(fnName: string, ...args: Array<string | number>): unknown {
      const literal = args.map((a) => JSON.stringify(a)).join(', ');
      return vm.runInContext(`${fnName}(${literal})`, context) as unknown;
    },
  };
}
```

`tools/build-data.ts`:
```ts
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
    fields: ['ID', 'Name Plural', 'Gesamt', 'AP', 'LE', 'SK', 'ZK', 'GS', 'EW',
             'Kulturen', 'Vorteil', 'Nachteil', 'Größe', 'Gewicht', 'Alter', 'Werke'] },
  { key: 'kulturen', fn: 'KulturGetInfo', count: 56,
    fields: ['ID', 'Name Plural', 'Gesamt', 'SFAllgemein', 'Sprache', 'Talent', 'Typ', 'Werke'] },
  { key: 'professionen', fn: 'ProfessionGetInfo', count: 951,
    fields: ['ID', 'Name', 'Gesamt', 'Typ', 'Werke'] },
  { key: 'vorteile', fn: 'VorteilGetInfo', count: 234, zeroBased: true,
    fields: ['ID', 'Name divers', 'BasisKosten', 'Regel', 'Typ', 'Verweise', 'Werke'] },
  { key: 'nachteile', fn: 'NachteilGetInfo', count: 161, zeroBased: true,
    fields: ['ID', 'Name divers', 'BasisKosten', 'Regel', 'Typ', 'Verweise', 'Werke'] },
  { key: 'kampftechniken', fn: 'KampftechnikGetInfo', count: 22,
    fields: ['ID', 'Name', 'Typ', 'SF', 'Werke'] },
  { key: 'zauber', fn: 'ZauberGetInfo', count: 856,
    fields: ['ID', 'Name', 'Probe', 'SF', 'Merkmal', 'Werke'] },
  { key: 'liturgien', fn: 'LiturgieGetInfo', count: 349,
    fields: ['ID', 'Name', 'Probe', 'SF', 'Werke'] },
  { key: 'sprachen', fn: 'SpracheGetInfo', count: 101, fields: ['ID', 'Name', 'Werke'] },
  { key: 'traditionen', fn: 'TraditionGetInfo', count: 61, fields: ['ID', 'Name', 'Werke'] },
];

const isEmpty = (v: unknown): boolean =>
  v === '' || v === undefined || v === null || (Array.isArray(v) && v.length === 0);

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
    const id = row['ID'];
    if (typeof id === 'string') {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    rows.push(row);
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
```

- [ ] **Step 4: Run tests and build the data**

Run: `npx playwright test --project=unit tests/unit/build-data.spec.ts && node tools/build-data.ts && npm run typecheck`
Expected: PASS — 7 tests; the build prints one line per dataset with non-zero row counts.

- [ ] **Step 5: Commit**

```bash
git add tools/acrobat-shim.ts tools/build-data.ts tests/unit/build-data.spec.ts app/data/
git commit -m "feat(tools): execute extracted rules JS and generate JSON datasets"
```

---

### Task 7: Shared domain types and Erfahrungsgrad module

**Files:**
- Create: `src/core/types.ts`, `src/core/experience.ts`
- Test: `tests/unit/experience.spec.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
```ts
// src/core/types.ts
export type EigenschaftName = 'MU' | 'KL' | 'IN' | 'CH' | 'FF' | 'GE' | 'KO' | 'KK';
export type Eigenschaften = Readonly<Record<EigenschaftName, number>>;
export type Spalte = 'A' | 'B' | 'C' | 'D';
export type Grundwerte = { readonly le: number; readonly sk: number; readonly zk: number; readonly gs: number };
export type Basiswerte = { readonly LE: number; readonly SK: number; readonly ZK: number;
                           readonly AW: number; readonly INI: number; readonly GS: number };
export type LimitGrund = 'eigenschaft' | 'erfahrungsgrad' | 'zauberobergrenze';
export type Limit = { readonly wert: number; readonly grund: LimitGrund };
export type ProblemCode = 'vorteil-ap' | 'nachteil-ap' | 'eigenschaft-min' | 'eigenschaft-max'
                        | 'eigenschaftspunkte' | 'rest-ap' | 'ap-ueberzogen';
export type Problem = { readonly code: ProblemCode; readonly feld: string | null;
                        readonly text: string; readonly ist: number; readonly erlaubt: number };

// src/core/experience.ts
export type Erfahrungsgrad = {
  readonly id: string; readonly name: string; readonly ap: number;
  readonly maxEigenschaft: number; readonly maxFertigkeit: number; readonly maxKampftechnik: number;
  readonly maxEigenschaftspunkte: number; readonly zauberAnzahl: number; readonly fremdzauber: number;
};
export const ERFAHRUNGSGRADE: readonly Erfahrungsgrad[];
export function erfahrungsgrad(idOrName: string): Erfahrungsgrad | undefined;
```

This table is **hardcoded, not generated** — the PDF stores only names and AP, never the caps. Values are transcribed verbatim from the Regel-Wiki (spec §5.1); AP is cross-checked against `ErfahrungsgradGetInfo` in Task 6.

- [ ] **Step 1: Write the failing test**

`tests/unit/experience.spec.ts`:
```ts
import { test, expect } from '@playwright/test';
import { ERFAHRUNGSGRADE, erfahrungsgrad } from '../../src/core/experience.ts';

test('has all seven Erfahrungsgrade in ascending order', () => {
  expect(ERFAHRUNGSGRADE.map((g) => g.name)).toEqual([
    'Unerfahren', 'Durchschnittlich', 'Erfahren', 'Kompetent', 'Meisterlich', 'Brillant', 'Legendär',
  ]);
});

test('matches the official table exactly', () => {
  const table: Array<[string, number, number, number, number, number, number, number]> = [
    ['Unerfahren', 900, 12, 10, 8, 95, 8, 0],
    ['Durchschnittlich', 1000, 13, 10, 10, 98, 10, 1],
    ['Erfahren', 1100, 14, 10, 12, 100, 12, 2],
    ['Kompetent', 1200, 15, 13, 14, 102, 14, 3],
    ['Meisterlich', 1400, 16, 16, 16, 105, 16, 4],
    ['Brillant', 1700, 17, 19, 18, 109, 18, 5],
    ['Legendär', 2100, 18, 20, 20, 114, 20, 6],
  ];
  for (const [name, ap, eig, fert, kt, punkte, zauber, fremd] of table) {
    const g = erfahrungsgrad(name);
    expect(g, name).toBeDefined();
    expect(
      [g!.ap, g!.maxEigenschaft, g!.maxFertigkeit, g!.maxKampftechnik,
       g!.maxEigenschaftspunkte, g!.zauberAnzahl, g!.fremdzauber],
      name,
    ).toEqual([ap, eig, fert, kt, punkte, zauber, fremd]);
  }
});

test('lookup works by id and is case-insensitive by name', () => {
  expect(erfahrungsgrad('erfahren')?.ap).toBe(1100);
  expect(erfahrungsgrad('EG3')?.name).toBe('Kompetent');
  expect(erfahrungsgrad('nonsense')).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test --project=unit tests/unit/experience.spec.ts`
Expected: FAIL — cannot resolve `src/core/experience.ts`.

- [ ] **Step 3: Write the implementation**

`src/core/types.ts`:
```ts
export type EigenschaftName = 'MU' | 'KL' | 'IN' | 'CH' | 'FF' | 'GE' | 'KO' | 'KK';
export type Eigenschaften = Readonly<Record<EigenschaftName, number>>;
export type Spalte = 'A' | 'B' | 'C' | 'D';

export type Grundwerte = {
  readonly le: number; readonly sk: number; readonly zk: number; readonly gs: number;
};

export type Basiswerte = {
  readonly LE: number; readonly SK: number; readonly ZK: number;
  readonly AW: number; readonly INI: number; readonly GS: number;
};

export type LimitGrund = 'eigenschaft' | 'erfahrungsgrad' | 'zauberobergrenze';
export type Limit = { readonly wert: number; readonly grund: LimitGrund };

export type ProblemCode =
  | 'vorteil-ap' | 'nachteil-ap'
  | 'eigenschaft-min' | 'eigenschaft-max' | 'eigenschaftspunkte'
  | 'rest-ap' | 'ap-ueberzogen';

export type Problem = {
  readonly code: ProblemCode;
  readonly feld: string | null;
  readonly text: string;
  readonly ist: number;
  readonly erlaubt: number;
};
```

`src/core/experience.ts`:
```ts
/**
 * Erfahrungsgrade nach DSA5.
 * Quelle: Regel-Wiki, Heldenerschaffung Schritt 2 (wortgetreue Tabelle).
 * AP zusätzlich gegen ErfahrungsgradGetInfo aus dem Heldendokument geprüft.
 * Die Grenzen gelten ausschließlich während der Erschaffung.
 */
export type Erfahrungsgrad = {
  readonly id: string;
  readonly name: string;
  readonly ap: number;
  readonly maxEigenschaft: number;
  readonly maxFertigkeit: number;
  readonly maxKampftechnik: number;
  readonly maxEigenschaftspunkte: number;
  readonly zauberAnzahl: number;
  readonly fremdzauber: number;
};

export const ERFAHRUNGSGRADE: readonly Erfahrungsgrad[] = Object.freeze([
  { id: 'EG0', name: 'Unerfahren', ap: 900, maxEigenschaft: 12, maxFertigkeit: 10, maxKampftechnik: 8, maxEigenschaftspunkte: 95, zauberAnzahl: 8, fremdzauber: 0 },
  { id: 'EG1', name: 'Durchschnittlich', ap: 1000, maxEigenschaft: 13, maxFertigkeit: 10, maxKampftechnik: 10, maxEigenschaftspunkte: 98, zauberAnzahl: 10, fremdzauber: 1 },
  { id: 'EG2', name: 'Erfahren', ap: 1100, maxEigenschaft: 14, maxFertigkeit: 10, maxKampftechnik: 12, maxEigenschaftspunkte: 100, zauberAnzahl: 12, fremdzauber: 2 },
  { id: 'EG3', name: 'Kompetent', ap: 1200, maxEigenschaft: 15, maxFertigkeit: 13, maxKampftechnik: 14, maxEigenschaftspunkte: 102, zauberAnzahl: 14, fremdzauber: 3 },
  { id: 'EG4', name: 'Meisterlich', ap: 1400, maxEigenschaft: 16, maxFertigkeit: 16, maxKampftechnik: 16, maxEigenschaftspunkte: 105, zauberAnzahl: 16, fremdzauber: 4 },
  { id: 'EG5', name: 'Brillant', ap: 1700, maxEigenschaft: 17, maxFertigkeit: 19, maxKampftechnik: 18, maxEigenschaftspunkte: 109, zauberAnzahl: 18, fremdzauber: 5 },
  { id: 'EG6', name: 'Legendär', ap: 2100, maxEigenschaft: 18, maxFertigkeit: 20, maxKampftechnik: 20, maxEigenschaftspunkte: 114, zauberAnzahl: 20, fremdzauber: 6 },
].map((g) => Object.freeze(g)));

export function erfahrungsgrad(idOrName: string): Erfahrungsgrad | undefined {
  const needle = idOrName.trim().toLowerCase();
  return ERFAHRUNGSGRADE.find(
    (g) => g.id.toLowerCase() === needle || g.name.toLowerCase() === needle,
  );
}
```

- [ ] **Step 4: Run test and typecheck**

Run: `npx playwright test --project=unit tests/unit/experience.spec.ts && npm run typecheck`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/types.ts src/core/experience.ts tests/unit/experience.spec.ts
git commit -m "feat(core): domain types and Erfahrungsgrad table"
```

---

### Task 8: AP cost formulas

**Files:**
- Create: `src/core/costs.ts`
- Test: `tests/unit/costs.spec.ts`

**Interfaces:**
- Consumes: `Spalte`, `Eigenschaften` from `./types.ts`
- Produces:
```ts
export const SPALTEN_FAKTOR: Readonly<Record<Spalte, number>>;
export function spaltenFaktor(spalte: string): number;               // throws on unknown column
export function eigenschaftKosten(wert: number): number;             // cumulative from 8
export function eigenschaftKostenGesamt(werte: readonly number[]): number;
export function fertigkeitKosten(wert: number, spalte: string, opts?: { aktivieren?: boolean }): number;
export function energieKosten(punkte: number): number;
```

Formulas transcribed from `EigenschaftAPRechner`, `TalentKosten`, `EnergieKosten`, `SpaltenFaktor` (spec §5.5). Activation costs A=1 / B=2 / C=3 / D=4 are independently confirmed by the Regel-Wiki.

- [ ] **Step 1: Write the failing test**

`tests/unit/costs.spec.ts`:
```ts
import { test, expect } from '@playwright/test';
import {
  spaltenFaktor, eigenschaftKosten, eigenschaftKostenGesamt, fertigkeitKosten, energieKosten,
} from '../../src/core/costs.ts';

test('column factors A-D', () => {
  expect([spaltenFaktor('A'), spaltenFaktor('B'), spaltenFaktor('C'), spaltenFaktor('D')])
    .toEqual([1, 2, 3, 4]);
  expect(spaltenFaktor('b')).toBe(2);
  expect(() => spaltenFaktor('Z')).toThrow();
});

test('attribute costs follow the official curve', () => {
  expect(eigenschaftKosten(8)).toBe(0);
  expect(eigenschaftKosten(7)).toBe(0);
  expect(eigenschaftKosten(9)).toBe(15);
  expect(eigenschaftKosten(13)).toBe(75);
  expect(eigenschaftKosten(14)).toBe(90);
  expect(eigenschaftKosten(15)).toBe(120);
  expect(eigenschaftKosten(16)).toBe(165);
  expect(eigenschaftKosten(18)).toBe(300);
});

test('eight attributes at 8 cost nothing', () => {
  expect(eigenschaftKostenGesamt([8, 8, 8, 8, 8, 8, 8, 8])).toBe(0);
});

test('a realistic Erfahren spread', () => {
  expect(eigenschaftKostenGesamt([14, 13, 12, 11, 10, 10, 9, 8])).toBe(345);
});

test('skill costs are linear to 11, then accelerate', () => {
  expect(fertigkeitKosten(0, 'B')).toBe(0);
  expect(fertigkeitKosten(1, 'A')).toBe(1);
  expect(fertigkeitKosten(10, 'B')).toBe(20);
  expect(fertigkeitKosten(11, 'B')).toBe(22);
  expect(fertigkeitKosten(12, 'B')).toBe(24);
  expect(fertigkeitKosten(13, 'B')).toBe(28);
  expect(fertigkeitKosten(14, 'D')).toBe(68);
});

test('activation adds one column factor', () => {
  expect(fertigkeitKosten(0, 'C', { aktivieren: true })).toBe(3);
  expect(fertigkeitKosten(5, 'C', { aktivieren: true })).toBe(18);
  expect(fertigkeitKosten(5, 'C')).toBe(15);
});

test('energy costs', () => {
  expect(energieKosten(0)).toBe(0);
  expect(energieKosten(1)).toBe(4);
  expect(energieKosten(11)).toBe(44);
  expect(energieKosten(12)).toBe(48);
  expect(energieKosten(13)).toBe(56);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test --project=unit tests/unit/costs.spec.ts`
Expected: FAIL — cannot resolve `src/core/costs.ts`.

- [ ] **Step 3: Write the implementation**

`src/core/costs.ts`:
```ts
/** AP-Kostenformeln. Quelle: Heldendokument V2.13, Regel-Wiki (Spec §5.5). */
import type { Spalte } from './types.ts';

export const SPALTEN_FAKTOR: Readonly<Record<Spalte, number>> = Object.freeze({
  A: 1, B: 2, C: 3, D: 4,
});

const isSpalte = (v: string): v is Spalte => v === 'A' || v === 'B' || v === 'C' || v === 'D';

export function spaltenFaktor(spalte: string): number {
  const key = spalte.trim().toUpperCase();
  if (!isSpalte(key)) throw new Error(`unbekannte Steigerungsspalte: ${spalte}`);
  return SPALTEN_FAKTOR[key];
}

/** Kumulative AP-Kosten, um eine Eigenschaft vom Startwert 8 auf `wert` zu bringen. */
export function eigenschaftKosten(wert: number): number {
  const w = Number.isFinite(wert) ? wert : 0;
  if (w <= 8) return 0;
  if (w <= 13) return (w - 8) * 15;
  return 75 + (w - 13) * (w - 12) * 7.5;
}

export function eigenschaftKostenGesamt(werte: readonly number[]): number {
  return werte.reduce((sum, w) => sum + eigenschaftKosten(w), 0);
}

/** Kosten für Fertigkeiten, Zauber und Liturgien — dieselbe Tabelle. */
export function fertigkeitKosten(
  wert: number,
  spalte: string,
  opts: { aktivieren?: boolean } = {},
): number {
  const faktor = spaltenFaktor(spalte);
  const w = Number.isFinite(wert) ? wert : 0;
  let kosten = 0;
  if (w > 0) kosten = w > 11 ? (11 + ((w - 11) * (w - 10)) / 2) * faktor : w * faktor;
  if (opts.aktivieren === true) kosten += faktor;
  return kosten;
}

export function energieKosten(punkte: number): number {
  const p = Number.isFinite(punkte) ? punkte : 0;
  if (p <= 0) return 0;
  if (p <= 11) return p * 4;
  return 44 + (p - 11) * (p - 10) * 2;
}
```

- [ ] **Step 4: Run test and typecheck**

Run: `npx playwright test --project=unit tests/unit/costs.spec.ts && npm run typecheck`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/costs.ts tests/unit/costs.spec.ts
git commit -m "feat(core): AP cost formulas for attributes, skills and energies"
```

---

### Task 9: Derived values

**Files:**
- Create: `src/core/derived.ts`
- Test: `tests/unit/derived.spec.ts`

**Interfaces:**
- Consumes: `Eigenschaften`, `Grundwerte`, `Basiswerte`, `EigenschaftName` from `./types.ts`
- Produces:
```ts
export const EIGENSCHAFTEN: readonly EigenschaftName[];
export const SCHICKSALSPUNKTE_START: 3;
export const ENERGIE_GRUNDWERT: 20;
export function lebensenergie(g: Grundwerte, e: Eigenschaften, mod?: number): number;
export function seelenkraft(g: Grundwerte, e: Eigenschaften, mod?: number): number;
export function zaehigkeit(g: Grundwerte, e: Eigenschaften, mod?: number): number;
export function ausweichen(e: Eigenschaften, mod?: number): number;
export function initiative(e: Eigenschaften, mod?: number): number;
export function geschwindigkeit(g: Grundwerte, mod?: number): number;
export function astralenergie(o: { leitwert: number; grundwert?: number; mod?: number }): number;
export function karmaenergie(o: { leitwert: number; grundwert?: number; mod?: number }): number;
export function basiswerte(g: Grundwerte, e: Eigenschaften,
                           mods?: Partial<Record<keyof Basiswerte, number>>): Basiswerte;
```

**Rounding:** DSA5 rounds derived values to the nearest integer (`Math.round`). `SK`/`ZK` divide by 6 and `AW`/`INI` by 2, so this is load-bearing. Formulas from spec §5.6; wiki and PDF agree. Note the Regel-Wiki has a typo calling ZK's base the *Seelenkraft*-Grundwert — it is the Zähigkeit-Grundwert.

- [ ] **Step 1: Write the failing test**

`tests/unit/derived.spec.ts`:
```ts
import { test, expect } from '@playwright/test';
import {
  EIGENSCHAFTEN, SCHICKSALSPUNKTE_START, basiswerte,
  lebensenergie, seelenkraft, zaehigkeit, ausweichen, initiative, geschwindigkeit,
  astralenergie, karmaenergie,
} from '../../src/core/derived.ts';
import type { Eigenschaften, Grundwerte } from '../../src/core/types.ts';

const E: Eigenschaften = { MU: 12, KL: 13, IN: 11, CH: 10, FF: 12, GE: 13, KO: 14, KK: 12 };
const G: Grundwerte = { le: 5, sk: -5, zk: -5, gs: 8 };

test('the eight attributes in sheet order', () => {
  expect(EIGENSCHAFTEN).toEqual(['MU', 'KL', 'IN', 'CH', 'FF', 'GE', 'KO', 'KK']);
});

test('Lebensenergie is base plus twice Konstitution', () => {
  expect(lebensenergie(G, E)).toBe(33);
  expect(lebensenergie(G, E, 3)).toBe(36);
});

test('Seelenkraft and Zähigkeit round to nearest', () => {
  expect(seelenkraft(G, E)).toBe(1);   // -5 + 36/6 = 1
  expect(zaehigkeit(G, E)).toBe(2);    // -5 + 40/6 = 1.67 -> round 7 - 5 = 2
});

test('Ausweichen and Initiative', () => {
  expect(ausweichen(E)).toBe(7);       // 13/2 = 6.5 -> 7
  expect(initiative(E)).toBe(13);      // 25/2 = 12.5 -> 13
});

test('Geschwindigkeit comes straight from the species base', () => {
  expect(geschwindigkeit(G)).toBe(8);
  expect(geschwindigkeit(G, -1)).toBe(7);
});

test('Astral- and Karmaenergie are base 20 plus the tradition lead attribute', () => {
  expect(astralenergie({ leitwert: 13 })).toBe(33);
  expect(karmaenergie({ leitwert: 12, mod: 2 })).toBe(34);
  expect(astralenergie({ leitwert: 13, grundwert: 20, mod: -3 })).toBe(30);
});

test('basiswerte assembles the whole set', () => {
  expect(basiswerte(G, E)).toEqual({ LE: 33, SK: 1, ZK: 2, AW: 7, INI: 13, GS: 8 });
});

test('every hero starts with three Schicksalspunkte', () => {
  expect(SCHICKSALSPUNKTE_START).toBe(3);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test --project=unit tests/unit/derived.spec.ts`
Expected: FAIL — cannot resolve `src/core/derived.ts`.

- [ ] **Step 3: Write the implementation**

`src/core/derived.ts`:
```ts
/** Abgeleitete Werte nach DSA5. Quelle: Regel-Wiki Schritt 12, Heldendokument (Spec §5.6). */
import type { Basiswerte, Eigenschaften, EigenschaftName, Grundwerte } from './types.ts';

export const EIGENSCHAFTEN: readonly EigenschaftName[] = Object.freeze([
  'MU', 'KL', 'IN', 'CH', 'FF', 'GE', 'KO', 'KK',
] as const);

export const SCHICKSALSPUNKTE_START = 3 as const;
export const ENERGIE_GRUNDWERT = 20 as const;

export const lebensenergie = (g: Grundwerte, e: Eigenschaften, mod = 0): number =>
  g.le + 2 * e.KO + mod;

export const seelenkraft = (g: Grundwerte, e: Eigenschaften, mod = 0): number =>
  Math.round(g.sk + (e.MU + e.KL + e.IN) / 6) + mod;

export const zaehigkeit = (g: Grundwerte, e: Eigenschaften, mod = 0): number =>
  Math.round(g.zk + (e.KO + e.KO + e.KK) / 6) + mod;

export const ausweichen = (e: Eigenschaften, mod = 0): number => Math.round(e.GE / 2) + mod;

export const initiative = (e: Eigenschaften, mod = 0): number =>
  Math.round((e.MU + e.GE) / 2) + mod;

export const geschwindigkeit = (g: Grundwerte, mod = 0): number => g.gs + mod;

export const astralenergie = (
  { leitwert, grundwert = ENERGIE_GRUNDWERT, mod = 0 }:
  { leitwert: number; grundwert?: number; mod?: number },
): number => grundwert + leitwert + mod;

export const karmaenergie = (
  { leitwert, grundwert = ENERGIE_GRUNDWERT, mod = 0 }:
  { leitwert: number; grundwert?: number; mod?: number },
): number => grundwert + leitwert + mod;

export function basiswerte(
  g: Grundwerte,
  e: Eigenschaften,
  mods: Partial<Record<keyof Basiswerte, number>> = {},
): Basiswerte {
  return {
    LE: lebensenergie(g, e, mods.LE ?? 0),
    SK: seelenkraft(g, e, mods.SK ?? 0),
    ZK: zaehigkeit(g, e, mods.ZK ?? 0),
    AW: ausweichen(e, mods.AW ?? 0),
    INI: initiative(e, mods.INI ?? 0),
    GS: geschwindigkeit(g, mods.GS ?? 0),
  };
}
```

- [ ] **Step 4: Run test and typecheck**

Run: `npx playwright test --project=unit tests/unit/derived.spec.ts && npm run typecheck`
Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/derived.ts tests/unit/derived.spec.ts
git commit -m "feat(core): derived values LE/SK/ZK/AW/INI/GS/AE/KE"
```

---

### Task 10: Creation limits and validation

**Files:**
- Create: `src/core/limits.ts`
- Test: `tests/unit/limits.spec.ts`

**Interfaces:**
- Consumes: `erfahrungsgrad` from `./experience.ts`; `Eigenschaften`, `EigenschaftName`, `Limit`, `Problem` from `./types.ts`
- Produces:
```ts
export const MAX_VORTEIL_AP: 80;
export const MAX_NACHTEIL_AP: 80;
export const MAX_REST_AP: 10;
export const MAX_ZAUBER_FW: 14;
export const EIGENSCHAFT_MIN: 8;
export const EIGENSCHAFT_START: 8;
export const KAMPFTECHNIK_START: 6;
export const FERTIGKEIT_START: 0;
export function maxFertigkeit(o: { probe: readonly EigenschaftName[]; eigenschaften: Eigenschaften;
                                   grad: string; herausragend?: number }): Limit;
export function maxKampftechnik(o: { leiteigenschaften: readonly EigenschaftName[];
                                     eigenschaften: Eigenschaften; grad: string; herausragend?: number }): Limit;
export function maxZauber(o: { probe: readonly EigenschaftName[]; eigenschaften: Eigenschaften;
                               grad: string; merkmalskenntnis?: boolean; herausragend?: number }): Limit;
export function pruefeVorNachteile(o: { vorteilAP: number; nachteilAP: number }): Problem[];
export function pruefeEigenschaften(o: { eigenschaften: Eigenschaften; grad: string }): Problem[];
export function pruefeRestAP(o: { budget: number; ausgegeben: number }): Problem[];
```

**Returning `Limit` rather than a bare number is the point of this module.** The spec requires the UI to say *which* cap is biting — "begrenzt durch KL 13 +2" versus "begrenzt durch Erfahrungsgrad 10". A number alone makes that impossible, and that missing distinction is a large part of why the PDF is unpleasant to use.

- [ ] **Step 1: Write the failing test**

`tests/unit/limits.spec.ts`:
```ts
import { test, expect } from '@playwright/test';
import {
  MAX_VORTEIL_AP, MAX_NACHTEIL_AP, MAX_REST_AP,
  EIGENSCHAFT_START, KAMPFTECHNIK_START, FERTIGKEIT_START,
  maxFertigkeit, maxKampftechnik, maxZauber,
  pruefeVorNachteile, pruefeEigenschaften, pruefeRestAP,
} from '../../src/core/limits.ts';
import type { Eigenschaften } from '../../src/core/types.ts';

const E: Eigenschaften = { MU: 12, KL: 13, IN: 11, CH: 10, FF: 12, GE: 13, KO: 14, KK: 12 };

test('constants match the official rules', () => {
  expect([MAX_VORTEIL_AP, MAX_NACHTEIL_AP, MAX_REST_AP]).toEqual([80, 80, 10]);
});

test('creation start values — Kampftechniken begin at 6, not 0', () => {
  expect(EIGENSCHAFT_START).toBe(8);
  expect(KAMPFTECHNIK_START).toBe(6);
  expect(FERTIGKEIT_START).toBe(0);
});

test('skill cap is the lower of attribute+2 and the Erfahrungsgrad cap', () => {
  expect(maxFertigkeit({ probe: ['KL', 'KL', 'IN'], eigenschaften: E, grad: 'Erfahren' }))
    .toEqual({ wert: 10, grund: 'erfahrungsgrad' });
  expect(maxFertigkeit({ probe: ['KL', 'KL', 'IN'], eigenschaften: E, grad: 'Legendär' }))
    .toEqual({ wert: 15, grund: 'eigenschaft' });
});

test('Herausragende Fertigkeit raises the attribute cap by one per rank', () => {
  expect(maxFertigkeit({ probe: ['KL'], eigenschaften: E, grad: 'Legendär', herausragend: 2 }))
    .toEqual({ wert: 17, grund: 'eigenschaft' });
});

test('combat technique cap uses the lead attribute plus two', () => {
  expect(maxKampftechnik({ leiteigenschaften: ['GE'], eigenschaften: E, grad: 'Legendär' }))
    .toEqual({ wert: 15, grund: 'eigenschaft' });
  expect(maxKampftechnik({ leiteigenschaften: ['GE'], eigenschaften: E, grad: 'Unerfahren' }))
    .toEqual({ wert: 8, grund: 'erfahrungsgrad' });
});

test('spells are additionally capped at 14 unless Merkmalskenntnis is present', () => {
  expect(maxZauber({ probe: ['KL', 'KL', 'KL'], eigenschaften: E, grad: 'Legendär' }))
    .toEqual({ wert: 14, grund: 'zauberobergrenze' });
  expect(maxZauber({ probe: ['KL', 'KL', 'KL'], eigenschaften: E, grad: 'Legendär', merkmalskenntnis: true }))
    .toEqual({ wert: 15, grund: 'eigenschaft' });
});

test('advantage and disadvantage AP limits', () => {
  expect(pruefeVorNachteile({ vorteilAP: 80, nachteilAP: 80 })).toEqual([]);
  const problems = pruefeVorNachteile({ vorteilAP: 95, nachteilAP: 81 });
  expect(problems.map((p) => p.code)).toEqual(['vorteil-ap', 'nachteil-ap']);
  expect(problems[0]).toMatchObject({ ist: 95, erlaubt: 80 });
});

test('attributes must stay within range and respect the point total', () => {
  const ok: Eigenschaften = { MU: 14, KL: 14, IN: 14, CH: 12, FF: 12, GE: 12, KO: 12, KK: 10 };
  expect(pruefeEigenschaften({ eigenschaften: ok, grad: 'Erfahren' })).toEqual([]);

  expect(pruefeEigenschaften({ eigenschaften: { ...ok, MU: 15 }, grad: 'Erfahren' })
    .map((p) => p.code)).toContain('eigenschaft-max');

  expect(pruefeEigenschaften({ eigenschaften: { ...ok, KK: 7 }, grad: 'Erfahren' })
    .map((p) => p.code)).toContain('eigenschaft-min');

  const tooMany: Eigenschaften = { MU: 14, KL: 14, IN: 14, CH: 13, FF: 13, GE: 13, KO: 13, KK: 13 };
  const problems = pruefeEigenschaften({ eigenschaften: tooMany, grad: 'Erfahren' });
  expect(problems.map((p) => p.code)).toContain('eigenschaftspunkte');
  expect(problems.find((p) => p.code === 'eigenschaftspunkte'))
    .toMatchObject({ ist: 107, erlaubt: 100 });
});

test('at most ten AP may be carried over, and never a negative balance', () => {
  expect(pruefeRestAP({ budget: 1100, ausgegeben: 1095 })).toEqual([]);
  expect(pruefeRestAP({ budget: 1100, ausgegeben: 1100 })).toEqual([]);
  expect(pruefeRestAP({ budget: 1100, ausgegeben: 1080 }).map((p) => p.code)).toEqual(['rest-ap']);
  expect(pruefeRestAP({ budget: 1100, ausgegeben: 1101 }).map((p) => p.code)).toEqual(['ap-ueberzogen']);
});

test('an unknown Erfahrungsgrad is rejected loudly', () => {
  expect(() => maxFertigkeit({ probe: ['KL'], eigenschaften: E, grad: 'Halbgott' })).toThrow();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test --project=unit tests/unit/limits.spec.ts`
Expected: FAIL — cannot resolve `src/core/limits.ts`.

- [ ] **Step 3: Write the implementation**

`src/core/limits.ts`:
```ts
/** Erschaffungsgrenzen nach DSA5. Quelle: Regel-Wiki (Spec §5.1–5.4, §5.7). */
import { erfahrungsgrad } from './experience.ts';
import type { Erfahrungsgrad } from './experience.ts';
import type { Eigenschaften, EigenschaftName, Limit, Problem, ProblemCode } from './types.ts';

export const MAX_VORTEIL_AP = 80 as const;
export const MAX_NACHTEIL_AP = 80 as const;
export const MAX_REST_AP = 10 as const;
export const MAX_ZAUBER_FW = 14 as const;
export const EIGENSCHAFT_MIN = 8 as const;

/** Startwerte der Erschaffung (Spec §5.3). Kampftechniken beginnen bei 6, nicht bei 0. */
export const EIGENSCHAFT_START = 8 as const;
export const KAMPFTECHNIK_START = 6 as const;
export const FERTIGKEIT_START = 0 as const;

const problem = (
  code: ProblemCode, feld: string | null, text: string, ist: number, erlaubt: number,
): Problem => ({ code, feld, text, ist, erlaubt });

const hoechste = (namen: readonly EigenschaftName[], e: Eigenschaften): number =>
  namen.reduce((max, n) => Math.max(max, e[n]), 0);

function gradOrThrow(grad: string): Erfahrungsgrad {
  const g = erfahrungsgrad(grad);
  if (!g) throw new Error(`unbekannter Erfahrungsgrad: ${grad}`);
  return g;
}

/** Die niedrigere Schranke gewinnt; `grund` benennt die greifende. */
function kleinere(kandidaten: readonly Limit[]): Limit {
  return kandidaten.reduce((best, c) => (c.wert < best.wert ? c : best));
}

export function maxFertigkeit(
  { probe, eigenschaften, grad, herausragend = 0 }:
  { probe: readonly EigenschaftName[]; eigenschaften: Eigenschaften; grad: string; herausragend?: number },
): Limit {
  const g = gradOrThrow(grad);
  return kleinere([
    { wert: hoechste(probe, eigenschaften) + 2 + herausragend, grund: 'eigenschaft' },
    { wert: g.maxFertigkeit, grund: 'erfahrungsgrad' },
  ]);
}

export function maxKampftechnik(
  { leiteigenschaften, eigenschaften, grad, herausragend = 0 }:
  { leiteigenschaften: readonly EigenschaftName[]; eigenschaften: Eigenschaften; grad: string; herausragend?: number },
): Limit {
  const g = gradOrThrow(grad);
  return kleinere([
    { wert: hoechste(leiteigenschaften, eigenschaften) + 2 + herausragend, grund: 'eigenschaft' },
    { wert: g.maxKampftechnik, grund: 'erfahrungsgrad' },
  ]);
}

export function maxZauber(
  { probe, eigenschaften, grad, merkmalskenntnis = false, herausragend = 0 }:
  { probe: readonly EigenschaftName[]; eigenschaften: Eigenschaften; grad: string;
    merkmalskenntnis?: boolean; herausragend?: number },
): Limit {
  const g = gradOrThrow(grad);
  const kandidaten: Limit[] = [
    { wert: hoechste(probe, eigenschaften) + 2 + herausragend, grund: 'eigenschaft' },
    { wert: g.maxFertigkeit, grund: 'erfahrungsgrad' },
  ];
  if (!merkmalskenntnis) kandidaten.push({ wert: MAX_ZAUBER_FW, grund: 'zauberobergrenze' });
  return kleinere(kandidaten);
}

export function pruefeVorNachteile(
  { vorteilAP, nachteilAP }: { vorteilAP: number; nachteilAP: number },
): Problem[] {
  const problems: Problem[] = [];
  if (vorteilAP > MAX_VORTEIL_AP) {
    problems.push(problem('vorteil-ap', 'Vorteile',
      `Höchstens ${MAX_VORTEIL_AP} AP dürfen in Vorteile investiert werden. ` +
      'Die automatisch durch die Spezies gewährten Vorteile zählen mit.',
      vorteilAP, MAX_VORTEIL_AP));
  }
  if (nachteilAP > MAX_NACHTEIL_AP) {
    problems.push(problem('nachteil-ap', 'Nachteile',
      `Höchstens ${MAX_NACHTEIL_AP} AP dürfen durch Nachteile gewonnen werden. ` +
      'Die automatisch durch die Spezies gewährten Nachteile zählen mit.',
      nachteilAP, MAX_NACHTEIL_AP));
  }
  return problems;
}

export function pruefeEigenschaften(
  { eigenschaften, grad }: { eigenschaften: Eigenschaften; grad: string },
): Problem[] {
  const g = gradOrThrow(grad);
  const problems: Problem[] = [];
  let summe = 0;

  for (const [name, wert] of Object.entries(eigenschaften) as Array<[EigenschaftName, number]>) {
    summe += wert;
    if (wert < EIGENSCHAFT_MIN) {
      problems.push(problem('eigenschaft-min', name,
        `${name} muss mindestens ${EIGENSCHAFT_MIN} betragen.`, wert, EIGENSCHAFT_MIN));
    }
    if (wert > g.maxEigenschaft) {
      problems.push(problem('eigenschaft-max', name,
        `${name} darf auf ${g.name} höchstens ${g.maxEigenschaft} betragen.`, wert, g.maxEigenschaft));
    }
  }

  if (summe > g.maxEigenschaftspunkte) {
    problems.push(problem('eigenschaftspunkte', null,
      `Die Summe aller Eigenschaften darf auf ${g.name} höchstens ${g.maxEigenschaftspunkte} betragen.`,
      summe, g.maxEigenschaftspunkte));
  }
  return problems;
}

export function pruefeRestAP(
  { budget, ausgegeben }: { budget: number; ausgegeben: number },
): Problem[] {
  const rest = budget - ausgegeben;
  if (rest < 0) {
    return [problem('ap-ueberzogen', null, 'Das AP-Budget ist überschritten.', ausgegeben, budget)];
  }
  if (rest > MAX_REST_AP) {
    return [problem('rest-ap', null,
      `Höchstens ${MAX_REST_AP} AP dürfen ungenutzt ins Spiel mitgenommen werden.`,
      rest, MAX_REST_AP)];
  }
  return [];
}
```

- [ ] **Step 4: Run the whole suite and typecheck**

Run: `npx playwright test && npm run typecheck && npm run build`
Expected: PASS — all unit specs plus the e2e smoke test; typecheck clean; `app/js/` emitted.

- [ ] **Step 5: Commit**

```bash
git add src/core/limits.ts tests/unit/limits.spec.ts
git commit -m "feat(core): creation limits and validation with cap attribution"
```

---

## Done when

- `npm run typecheck` is clean under `strict` with `noUncheckedIndexedAccess`.
- `npx playwright test` is green: 9 unit spec files plus the e2e smoke test.
- `npm run build:data` regenerates `app/data/*.json` from the PDF with no manual steps.
- `app/data/*.json` is committed and every dataset matches the row counts in the spec table.
- `npm run build` emits `app/js/` and nothing in `src/` imports from `node_modules` (enforced by `types: []` in `tsconfig.app.json`).

## Next plan

Plan 2 (Assistent) builds the wizard shell, the character model, the store with autosave, and steps 1–7 on top of `src/core/` and `app/data/`.
