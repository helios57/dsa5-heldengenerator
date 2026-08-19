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
      new Blob([src as BlobPart]).stream().pipeThrough(new CompressionStream('deflate')),
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
