import { Parser, inflate, applyPredictor, latin1, isDict, isRef, isName, isArray, isStream } from './pdf-lexer.ts';
import type { PdfDict, PdfObject, PdfStream, PdfValue } from './pdf-lexer.ts';

export type XrefEntry = { type: 1; offset: number } | { type: 2; stm: number; idx: number };

export class PDFDoc {
  readonly bytes: Uint8Array;
  readonly index = new Map<number, XrefEntry>();
  readonly trailer: PdfDict = new Map();
  private readonly cache = new Map<number, PdfObject | null>();
  private readonly objStmCache = new Map<number, Map<number, PdfValue>>();
  private readonly objStmLoading = new Set<number>();
  private readonly seenXrefOffsets = new Set<number>();

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
    while (next !== undefined && !this.seenXrefOffsets.has(next)) {
      this.seenXrefOffsets.add(next);
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
      const maxEntries = Math.floor((this.bytes.length - p.p) / 20);
      if (count > maxEntries) throw new Error('xref subsection count exceeds buffer size');
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
    if (typeof hybrid === 'number' && !this.seenXrefOffsets.has(hybrid)) {
      this.seenXrefOffsets.add(hybrid);
      await this.parseXrefSection(hybrid);
    }
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

    const rowWidth = (w0 ?? 1) + (w1 ?? 0) + (w2 ?? 0);
    if (rowWidth <= 0) throw new Error('xref stream /W has zero row width');

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
      const maxRows = Math.floor((data.length - pos) / rowWidth);
      if (count > maxRows) throw new Error('xref stream /Index count exceeds stream data size');
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
    if (this.objStmLoading.has(stmNum)) {
      throw new Error(`object stream ${stmNum} is self-referential`);
    }
    this.objStmLoading.add(stmNum);
    try {
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
      if (count < 0 || count > data.length) {
        throw new Error('object stream /N exceeds stream data size');
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
    } finally {
      this.objStmLoading.delete(stmNum);
    }
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
