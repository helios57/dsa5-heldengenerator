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
  // `numeric()` cannot resolve indirect references (it has no PDFDoc to call `get` on), so
  // a present-but-non-numeric value (e.g. an unresolved `{ ref, gen }`) is a caller bug, not
  // a legitimately absent key — silently substituting the PDF-spec default in that case would
  // produce a wrong row length and garbage-decode the stream instead of failing loudly.
  // Only a genuinely *missing* key falls back to the spec default.
  const numeric = (key: string, fallback: number): number => {
    const v = parms.get(key);
    if (v === undefined) return fallback;
    if (typeof v !== 'number') {
      throw new Error(`PDF stream /${key} is not a direct number (indirect reference?)`);
    }
    return v;
  };
  const predictor = numeric('Predictor', 1);
  if (predictor < 2) return data;
  if (predictor === 2) {
    throw new Error('unsupported stream predictor: TIFF Predictor 2 (/Predictor 2) is not implemented');
  }
  if (predictor < 10) {
    throw new Error(`invalid stream /Predictor value: ${predictor} (valid values are 1, 2, and 10-15)`);
  }

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
