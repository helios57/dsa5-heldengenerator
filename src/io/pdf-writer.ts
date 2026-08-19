// Fills the AcroForm fields of the Heldendokument PDF by appending an incremental update:
// the changed objects (fields, widgets, freshly generated appearance-stream XObjects) plus a
// new cross-reference stream, written after the original bytes. The original document, and the
// `PDFDoc` instance describing it, are both read-only inputs - nothing here mutates either.
//
// The critical correctness requirement (see module docs on the calling side) is that every
// widget of a field gets its OWN regenerated /AP - setting /V and leaving stale per-widget
// appearances in place produces a document that displays/prints the wrong value in most
// viewers, because AcroForm's /NeedAppearances is not honoured everywhere.

import { Parser, bytesFrom, isDict, isArray, isName, isPdfString, isRef } from './pdf-lexer.ts';
import type { PdfDict, PdfValue, PdfRef, PdfObject } from './pdf-lexer.ts';
import type { PDFDoc } from './pdf-document.ts';
import type { FieldInfo, Widget } from './pdf-acroform.ts';
import { decodeText } from './pdf-acroform.ts';

export type FeldWerte = ReadonlyMap<string, string>;

// --- tunables for the auto-sizing / layout heuristics -----------------------------------

const MIN_FONT_SIZE = 4;
const MAX_FONT_SIZE = 24;
const PAD_X = 2; // total horizontal inset (both sides combined) subtracted when fitting text
const PAD_Y = 2; // total vertical inset (both sides combined) subtracted when fitting text
// Used only when a font has no /FontDescriptor (e.g. the undecorated base-14 entries in this
// document's /DR, such as /Helv) and so no Ascent/Descent to size against. Values approximate
// Helvetica's real metrics (718/-207 per 1000 em) closely enough for a fallback.
const FALLBACK_ASCENT = 0.75;
const FALLBACK_DESCENT = -0.25;
// Used when a code point falls outside a font's Widths coverage, or the font carries no
// Widths array at all (again, the undecorated base-14 /DR entries).
const FALLBACK_GLYPH_WIDTH = 500;

// --- PDF value serialisation -------------------------------------------------------------
// Turns parsed `PdfValue`s (and dicts we've built ourselves) back into PDF syntax bytes, for
// re-emission as part of the incremental update. Every `PdfValue` variant from pdf-lexer.ts
// is handled explicitly - the exhaustive `never` fallthrough guards against a case being missed
// if the union ever grows.

const DELIMS = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);

function isPdfKeyword(v: PdfValue): v is { readonly kw: string } {
  return typeof v === 'object' && v !== null && !(v instanceof Map) && !Array.isArray(v)
    && 'kw' in v && typeof (v as { kw: unknown }).kw === 'string';
}

function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return '0';
  let s = n.toFixed(6);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  if (s === '-0') s = '0';
  return s;
}

// PdfName.name is a JS string where each char code is a raw byte (0-255) - the parser builds
// it that way (see Parser.name() in pdf-lexer.ts), so re-escaping here mirrors that byte-wise.
function escName(name: string): string {
  let out = '/';
  for (let i = 0; i < name.length; i++) {
    const c = name.charCodeAt(i) & 0xff;
    if (c === 0x23 || c <= 0x20 || c > 0x7e || DELIMS.has(c)) {
      out += '#' + c.toString(16).padStart(2, '0');
    } else {
      out += String.fromCharCode(c);
    }
  }
  return out;
}

function escLiteral(bytes: Uint8Array): string {
  let out = '(';
  for (const b of bytes) {
    if (b === 0x28 || b === 0x29 || b === 0x5c) out += '\\' + String.fromCharCode(b);
    else if (b < 0x20 || b === 0x7f) out += '\\' + b.toString(8).padStart(3, '0');
    else out += String.fromCharCode(b);
  }
  return out + ')';
}

function serializeValue(v: PdfValue): string {
  if (v === null) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return fmtNum(v);
  if (isName(v)) return escName(v.name);
  if (isPdfString(v)) return escLiteral(v.str);
  if (isRef(v)) return `${v.ref} ${v.gen} R`;
  if (isArray(v)) return `[${v.map(serializeValue).join(' ')}]`;
  if (isDict(v)) return serializeDict(v);
  if (isPdfKeyword(v)) return v.kw;
  const _exhaustive: never = v;
  throw new Error(`unserialisable PDF value: ${JSON.stringify(_exhaustive)}`);
}

function serializeDict(d: PdfDict): string {
  const parts: string[] = [];
  for (const [k, val] of d) parts.push(`${escName(k)} ${serializeValue(val)}`);
  return `<< ${parts.join(' ')} >>`;
}

function serializeIndirect(num: number, gen: number, value: PdfValue): Uint8Array {
  return bytesFrom(`${num} ${gen} obj\n${serializeValue(value)}\nendobj\n`);
}

function serializeIndirectStream(num: number, gen: number, dict: PdfDict, data: Uint8Array): Uint8Array {
  const header = bytesFrom(`${num} ${gen} obj\n${serializeDict(dict)}\nstream\n`);
  const footer = bytesFrom(`\nendstream\nendobj\n`);
  const out = new Uint8Array(header.length + data.length + footer.length);
  out.set(header, 0);
  out.set(data, header.length);
  out.set(footer, header.length + data.length);
  return out;
}

// --- small resolution helpers -------------------------------------------------------------

async function resolveNumber(doc: PDFDoc, v: PdfValue | undefined): Promise<number | null> {
  const r = await doc.resolve(v as PdfObject | undefined);
  return typeof r === 'number' ? r : null;
}

async function resolveRect(doc: PDFDoc, dict: PdfDict): Promise<[number, number, number, number]> {
  const raw = await doc.resolve(dict.get('Rect') as PdfObject | undefined);
  if (!isArray(raw) || raw.length !== 4) throw new Error('widget has no usable /Rect');
  const nums: number[] = [];
  for (const entry of raw) {
    const n = await resolveNumber(doc, entry);
    if (n === null) throw new Error('widget /Rect entry is not a number');
    nums.push(n);
  }
  return [nums[0] ?? 0, nums[1] ?? 0, nums[2] ?? 0, nums[3] ?? 0];
}

async function resolveDAString(doc: PDFDoc, v: PdfValue | undefined): Promise<string | null> {
  const r = await doc.resolve(v as PdfObject | undefined);
  return isPdfString(r) ? decodeText(r.str) : null;
}

type ParsedDA = { readonly font: string; readonly size: number; readonly color: string };

function parseDA(da: string): ParsedDA {
  const tokens = da.trim().split(/\s+/);
  const tfIdx = tokens.indexOf('Tf');
  if (tfIdx < 2) throw new Error(`/DA has no usable "/Font size Tf": ${JSON.stringify(da)}`);
  const fontTok = tokens[tfIdx - 2] ?? '';
  const sizeTok = tokens[tfIdx - 1] ?? '0';
  if (!fontTok.startsWith('/')) throw new Error(`/DA font operand is not a name: ${JSON.stringify(da)}`);
  const size = parseFloat(sizeTok);
  const color = tokens.slice(tfIdx + 1).join(' ') || '0 g';
  return { font: fontTok.slice(1), size: Number.isFinite(size) ? size : 0, color };
}

// Generation numbers: objects stored inside an object stream always have generation 0
// (ISO 32000-1 7.5.7). For a classic top-level object we read the real generation out of its
// "N G obj" header rather than assume 0, since PDFDoc's XrefEntry doesn't retain it.
async function resolveGen(doc: PDFDoc, num: number): Promise<number> {
  const entry = doc.index.get(num);
  if (!entry) throw new Error(`object ${num} has no xref entry`);
  if (entry.type === 2) return 0;
  const p = new Parser(doc.bytes, entry.offset);
  p.token();
  const genTok = p.token();
  const gen = genTok === null ? NaN : parseInt(genTok, 10);
  return Number.isFinite(gen) ? gen : 0;
}

// --- font metrics ---------------------------------------------------------------------------

type FontMetrics = {
  readonly ascent: number; // em fraction, e.g. 1.053
  readonly descent: number; // em fraction, negative
  readonly width: (code: number) => number; // em fraction (glyph width / 1000)
};

async function loadFontMetrics(doc: PDFDoc, fontDict: PdfDict): Promise<FontMetrics> {
  const firstChar = await resolveNumber(doc, fontDict.get('FirstChar'));
  const widthsRaw = await doc.resolve(fontDict.get('Widths') as PdfObject | undefined);
  const descriptor = await doc.resolveDict(fontDict.get('FontDescriptor') as PdfObject | undefined);
  const missingWidth = descriptor ? await resolveNumber(doc, descriptor.get('MissingWidth')) : null;
  const fallback = (missingWidth ?? FALLBACK_GLYPH_WIDTH) / 1000;

  let widths: number[] | null = null;
  if (isArray(widthsRaw) && firstChar !== null) {
    widths = [];
    for (const entry of widthsRaw) {
      const n = typeof entry === 'number' ? entry : null;
      widths.push(n ?? (missingWidth ?? FALLBACK_GLYPH_WIDTH));
    }
  }
  const first = firstChar ?? 0;

  const ascentRaw = descriptor ? await resolveNumber(doc, descriptor.get('Ascent')) : null;
  const descentRaw = descriptor ? await resolveNumber(doc, descriptor.get('Descent')) : null;
  const ascent = ascentRaw !== null && ascentRaw !== 0 ? ascentRaw / 1000 : FALLBACK_ASCENT;
  const descent = descentRaw !== null && descentRaw !== 0 ? descentRaw / 1000 : FALLBACK_DESCENT;

  return {
    ascent,
    descent,
    width: (code: number): number => {
      if (widths) {
        const idx = code - first;
        const w = idx >= 0 && idx < widths.length ? widths[idx] : undefined;
        return (w ?? missingWidth ?? FALLBACK_GLYPH_WIDTH) / 1000;
      }
      return fallback;
    },
  };
}

function widthOfText(text: string, metrics: FontMetrics): number {
  let w = 0;
  for (let i = 0; i < text.length; i++) w += metrics.width(text.charCodeAt(i) & 0xff);
  return w;
}

// --- text layout ----------------------------------------------------------------------------

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}

function wrapLines(text: string, size: number, availW: number, metrics: FontMetrics): string[] {
  const paragraphs = text.split(/\r\n|\r|\n/);
  const lines: string[] = [];
  for (const para of paragraphs) {
    if (para === '') {
      lines.push('');
      continue;
    }
    const words = para.split(' ');
    let cur = '';
    for (const word of words) {
      const candidate = cur ? `${cur} ${word}` : word;
      if (cur === '' || widthOfText(candidate, metrics) * size <= availW) {
        cur = candidate;
      } else {
        lines.push(cur);
        cur = word;
      }
    }
    lines.push(cur);
  }
  return lines;
}

function pickFontSize(
  daSize: number,
  text: string,
  boxW: number,
  boxH: number,
  metrics: FontMetrics,
  multiline: boolean,
): number {
  if (daSize > 0) return daSize;
  const lineHeightEm = Math.max(metrics.ascent - metrics.descent, 0.1);
  const availH = Math.max(boxH - PAD_Y, 1);
  const availW = Math.max(boxW - PAD_X, 1);

  if (!multiline) {
    const byHeight = availH / lineHeightEm;
    const unitWidth = widthOfText(text, metrics);
    const byWidth = unitWidth > 0 ? availW / unitWidth : Infinity;
    return clamp(Math.min(byHeight, byWidth), MIN_FONT_SIZE, MAX_FONT_SIZE);
  }

  // Multiline auto-size: start from a one-line upper bound, then shrink to fit however many
  // lines the greedy wrap actually needs at that size. A handful of iterations converges in
  // practice; this is a fit heuristic, not a claim of matching Acrobat's own algorithm.
  let size = clamp(availH / lineHeightEm, MIN_FONT_SIZE, MAX_FONT_SIZE);
  for (let i = 0; i < 6; i++) {
    const lines = wrapLines(text, size, availW, metrics);
    const neededH = lines.length * lineHeightEm * size;
    if (neededH <= availH || size <= MIN_FONT_SIZE) break;
    size = Math.max(MIN_FONT_SIZE, availH / (lines.length * lineHeightEm));
  }
  return clamp(size, MIN_FONT_SIZE, MAX_FONT_SIZE);
}

function alignX(text: string, size: number, boxW: number, metrics: FontMetrics, q: number): number {
  const textW = widthOfText(text, metrics) * size;
  if (q === 1) return Math.max((boxW - textW) / 2, 0); // centre
  if (q === 2) return Math.max(boxW - textW - PAD_X / 2, 0); // right
  return PAD_X / 2; // left (default)
}

// Baseline offset that vertically centres one line of text in the box, derived from the font's
// ascent/descent: the glyph block has visual height (ascent - descent) * size, and centring
// that block within boxH puts the baseline at (boxH - ascentPt - descentPt) / 2 above the box
// bottom. Cross-checked against this document's own pre-baked appearance for MU_1 (a 22.677pt
// box, 16.204pt AlegreyaSans,Bold, Ascent 1053/Descent -277): the formula gives 5.05 vs the
// original's recorded 5.0512.
function baselineY(boxH: number, size: number, metrics: FontMetrics): number {
  const ascentPt = metrics.ascent * size;
  const descentPt = metrics.descent * size;
  return (boxH - ascentPt - descentPt) / 2;
}

// --- appearance content stream ---------------------------------------------------------------

type WidgetDA = { readonly fontName: string; readonly size: number; readonly color: string };

function buildContentStream(
  text: string,
  boxW: number,
  boxH: number,
  da: WidgetDA,
  metrics: FontMetrics,
  q: number,
  multiline: boolean,
  comb: boolean,
  maxLen: number | null,
): string {
  const fontTok = escName(da.fontName);
  const lines: string[] = ['/Tx BMC', 'q', 'BT', `${fontTok} ${fmtNum(da.size)} Tf`, da.color];

  if (comb && maxLen !== null && maxLen > 0) {
    const cell = boxW / maxLen;
    const y = fmtNum(baselineY(boxH, da.size, metrics));
    for (let i = 0; i < text.length && i < maxLen; i++) {
      const ch = text[i] ?? '';
      const chW = widthOfText(ch, metrics) * da.size;
      const x = i * cell + Math.max((cell - chW) / 2, 0);
      lines.push(`1 0 0 1 ${fmtNum(x)} ${y} Tm`);
      lines.push(`${escLiteral(bytesFrom(ch))} Tj`);
    }
  } else if (multiline) {
    const rawLines = wrapLines(text, da.size, Math.max(boxW - PAD_X, 1), metrics);
    const lineHeightEm = Math.max(metrics.ascent - metrics.descent, 0.1);
    const lineHeightPt = lineHeightEm * da.size;
    const totalH = rawLines.length * lineHeightPt;
    const topY = boxH - Math.max((boxH - totalH) / 2, PAD_Y / 2);
    let y = topY - metrics.ascent * da.size;
    let prevX = 0;
    let prevY = 0;
    let first = true;
    for (const line of rawLines) {
      const x = alignX(line, da.size, boxW, metrics, q);
      if (first) {
        lines.push(`${fmtNum(x)} ${fmtNum(y)} Td`);
        first = false;
      } else {
        lines.push(`${fmtNum(x - prevX)} ${fmtNum(y - prevY)} Td`);
      }
      prevX = x;
      prevY = y;
      lines.push(`${escLiteral(bytesFrom(line))} Tj`);
      y -= lineHeightPt;
    }
  } else {
    const x = alignX(text, da.size, boxW, metrics, q);
    const y = baselineY(boxH, da.size, metrics);
    lines.push(`${fmtNum(x)} ${fmtNum(y)} Td`);
    lines.push(`${escLiteral(bytesFrom(text))} Tj`);
  }

  lines.push('ET', 'Q', 'EMC');
  return lines.join('\n') + '\n';
}

// --- UTF-16BE encoding for /V ------------------------------------------------------------
// PDF text strings for non-ASCII field values (German umlauts throughout this form's data) need
// a UTF-16BE encoding with a leading BOM. JS strings are already UTF-16 internally, so
// charCodeAt gives exactly the code units to write big-endian - this also handles characters
// outside the BMP correctly, since surrogate halves round-trip the same way.
function utf16beWithBom(text: string): Uint8Array {
  const out = new Uint8Array(2 + text.length * 2);
  out[0] = 0xfe;
  out[1] = 0xff;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    out[2 + i * 2] = (code >> 8) & 0xff;
    out[2 + i * 2 + 1] = code & 0xff;
  }
  return out;
}

// --- incremental update assembly ----------------------------------------------------------

const FF_MULTILINE = 1 << 12; // bit 13
const FF_COMB = 1 << 24; // bit 25

function groupRuns(nums: readonly number[]): Array<[number, number]> {
  const sorted = [...nums].sort((a, b) => a - b);
  const runs: Array<[number, number]> = [];
  for (const n of sorted) {
    const last = runs[runs.length - 1];
    if (last && last[0] + last[1] === n) {
      last[1]++;
    } else {
      runs.push([n, 1]);
    }
  }
  return runs;
}

function xrefRow(type: number, a: number, b: number): [number, number, number] {
  return [type, a, b];
}

export async function schreibeFormular(
  original: Uint8Array,
  doc: PDFDoc,
  felder: Map<string, FieldInfo>,
  werte: FeldWerte,
): Promise<Uint8Array> {
  const root = await doc.resolveDict(doc.trailer.get('Root'));
  if (!root) throw new Error('document has no catalog');
  const acroFormRef = root.get('AcroForm');
  const acroForm = await doc.resolveDict(acroFormRef);
  if (!acroForm) throw new Error('document has no AcroForm');
  const dr = await doc.resolveDict(acroForm.get('DR'));
  const drFonts = dr ? await doc.resolveDict(dr.get('Font')) : null;
  if (!drFonts) throw new Error('AcroForm /DR has no /Font resources');

  const sizeVal = doc.trailer.get('Size');
  if (typeof sizeVal !== 'number') throw new Error('trailer /Size is not a number');
  let nextObjNum = sizeVal;

  // Pending edits to existing objects, keyed by object number so a field with no Kids (whose
  // field dict and widget dict are the same object) accumulates both the /V and /AP edits onto
  // a single clone, instead of the second write clobbering the first.
  const pendingDicts = new Map<number, PdfDict>();
  const pendingGens = new Map<number, number>();
  const getPending = async (num: number): Promise<PdfDict> => {
    const cached = pendingDicts.get(num);
    if (cached) return cached;
    const orig = await doc.get(num);
    if (!isDict(orig)) throw new Error(`object ${num} is not a dictionary`);
    const clone: PdfDict = new Map(orig);
    pendingDicts.set(num, clone);
    pendingGens.set(num, await resolveGen(doc, num));
    return clone;
  };

  type NewStreamObj = { readonly num: number; readonly gen: number; readonly dict: PdfDict; readonly data: Uint8Array };
  const newObjects: NewStreamObj[] = [];

  const fontMetricsCache = new Map<string, FontMetrics>();
  const fontRefCache = new Map<string, PdfRef>();
  const getFont = async (name: string): Promise<{ ref: PdfRef; metrics: FontMetrics }> => {
    const cachedMetrics = fontMetricsCache.get(name);
    const cachedRef = fontRefCache.get(name);
    if (cachedMetrics && cachedRef) return { ref: cachedRef, metrics: cachedMetrics };
    const entry = drFonts.get(name);
    if (!isRef(entry)) throw new Error(`AcroForm /DR /Font /${name} is not an indirect reference`);
    const fontDict = await doc.resolveDict(entry);
    if (!fontDict) throw new Error(`AcroForm /DR /Font /${name} does not resolve to a dictionary`);
    const metrics = await loadFontMetrics(doc, fontDict);
    fontMetricsCache.set(name, metrics);
    fontRefCache.set(name, entry);
    return { ref: entry, metrics };
  };

  const resolveDA = async (widget: Widget, field: FieldInfo): Promise<string> => {
    const w = await resolveDAString(doc, widget.dict.get('DA'));
    if (w !== null) return w;
    const f = await resolveDAString(doc, field.dict.get('DA'));
    if (f !== null) return f;
    const a = await resolveDAString(doc, acroForm.get('DA'));
    if (a !== null) return a;
    throw new Error(`no /DA resolvable for field "${field.name}"`);
  };

  for (const [name, value] of werte) {
    const field = felder.get(name);
    if (!field) throw new Error(`unknown field: ${name}`);
    if (field.ref === null) throw new Error(`field "${name}" has no indirect object reference`);

    const fieldClone = await getPending(field.ref);
    const valueBytes = utf16beWithBom(value);
    fieldClone.set('V', { str: valueBytes });

    const ffRaw = await resolveNumber(doc, field.dict.get('Ff'));
    const ff = ffRaw ?? 0;
    const multiline = (ff & FF_MULTILINE) !== 0;
    const comb = (ff & FF_COMB) !== 0;
    const qFieldRaw = await resolveNumber(doc, field.dict.get('Q'));
    const maxLenRaw = await resolveNumber(doc, field.dict.get('MaxLen'));

    for (const widget of field.widgets) {
      if (widget.ref === null) throw new Error(`field "${name}" has a widget with no object reference`);
      const widgetClone = await getPending(widget.ref);
      if (widgetClone.has('V')) widgetClone.set('V', { str: valueBytes });

      const [x0, y0, x1, y1] = await resolveRect(doc, widgetClone);
      const boxW = Math.abs(x1 - x0);
      const boxH = Math.abs(y1 - y0);

      const qWidgetRaw = await resolveNumber(doc, widgetClone.get('Q'));
      const q = qWidgetRaw ?? qFieldRaw ?? 0;

      const daStr = await resolveDA(widget, field);
      const parsed = parseDA(daStr);
      const { ref: fontRef, metrics } = await getFont(parsed.font);
      const size = pickFontSize(parsed.size, value, boxW, boxH, metrics, multiline);

      const content = buildContentStream(
        value,
        boxW,
        boxH,
        { fontName: parsed.font, size, color: parsed.color },
        metrics,
        q,
        multiline,
        comb,
        maxLenRaw,
      );
      const contentBytes = bytesFrom(content);

      const apNum = nextObjNum++;
      const apDict: PdfDict = new Map<string, PdfValue>([
        ['Type', { name: 'XObject' }],
        ['Subtype', { name: 'Form' }],
        ['FormType', 1],
        ['BBox', [0, 0, boxW, boxH]],
        [
          'Resources',
          new Map<string, PdfValue>([
            ['Font', new Map<string, PdfValue>([[parsed.font, fontRef]])],
            ['ProcSet', [{ name: 'PDF' }, { name: 'Text' }]],
          ]),
        ],
        ['Length', contentBytes.length],
      ]);
      newObjects.push({ num: apNum, gen: 0, dict: apDict, data: contentBytes });

      widgetClone.set('AP', new Map<string, PdfValue>([['N', { ref: apNum, gen: 0 }]]));
    }
  }

  // NeedAppearances must stay off - we've generated real appearance streams, and leaving it on
  // (or true) invites some viewers to regenerate (and some print pipelines to ignore) them.
  const needApp = acroForm.get('NeedAppearances');
  if (needApp === true) {
    if (!isRef(acroFormRef)) throw new Error('AcroForm is not an indirect object; cannot rewrite /NeedAppearances');
    const acroClone = await getPending(acroFormRef.ref);
    acroClone.set('NeedAppearances', false);
  }

  // --- assemble the incremental update -----------------------------------------------------

  const chunks: Uint8Array[] = [original];
  let offset = original.length;
  const objOffsets = new Map<number, number>();

  const append = (bytes: Uint8Array): number => {
    const at = offset;
    chunks.push(bytes);
    offset += bytes.length;
    return at;
  };

  for (const obj of newObjects) {
    const bytes = serializeIndirectStream(obj.num, obj.gen, obj.dict, obj.data);
    objOffsets.set(obj.num, append(bytes));
  }
  for (const [num, dict] of [...pendingDicts].sort((a, b) => a[0] - b[0])) {
    const gen = pendingGens.get(num) ?? 0;
    const bytes = serializeIndirect(num, gen, dict);
    objOffsets.set(num, append(bytes));
  }

  const xrefNum = nextObjNum++;
  const xrefOffset = offset; // recorded before the xref object's own bytes are appended

  const allNums = [...objOffsets.keys(), xrefNum].sort((a, b) => a - b);
  const runs = groupRuns(allNums);
  const indexArr: number[] = [];
  const rows: Array<[number, number, number]> = [];
  for (const [first, count] of runs) {
    indexArr.push(first, count);
    for (let n = first; n < first + count; n++) {
      if (n === xrefNum) {
        rows.push(xrefRow(1, xrefOffset, 0));
      } else {
        rows.push(xrefRow(1, objOffsets.get(n) ?? 0, 0));
      }
    }
  }

  const W: [number, number, number] = [1, 4, 2];
  const xrefData = new Uint8Array(rows.length * (W[0] + W[1] + W[2]));
  let p = 0;
  const writeBE = (value: number, width: number): void => {
    for (let i = width - 1; i >= 0; i--) {
      xrefData[p++] = (value >>> (8 * i)) & 0xff;
    }
  };
  for (const [type, a, b] of rows) {
    writeBE(type, W[0]);
    writeBE(a, W[1]);
    writeBE(b, W[2]);
  }

  const oldStartxref = doc.startxrefOffsets().at(-1);
  if (oldStartxref === undefined) throw new Error('original document has no startxref to chain from');

  const trailerId = doc.trailer.get('ID');
  const trailerInfo = doc.trailer.get('Info');
  const xrefDictEntries: Array<[string, PdfValue]> = [
    ['Type', { name: 'XRef' }],
    ['Size', xrefNum + 1],
    ['Index', indexArr],
    ['W', [...W]],
    ['Root', doc.trailer.get('Root') as PdfValue],
    ['Prev', oldStartxref],
    ['Length', xrefData.length],
  ];
  if (trailerInfo !== undefined) xrefDictEntries.push(['Info', trailerInfo]);
  if (trailerId !== undefined) xrefDictEntries.push(['ID', trailerId]);
  const xrefDict: PdfDict = new Map(xrefDictEntries);

  append(serializeIndirectStream(xrefNum, 0, xrefDict, xrefData));
  append(bytesFrom(`startxref\n${xrefOffset}\n%%EOF\n`));

  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let w = 0;
  for (const c of chunks) {
    out.set(c, w);
    w += c.length;
  }
  return out;
}
