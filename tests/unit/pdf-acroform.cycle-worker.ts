// Runs the Kids-cycle scenario in an isolated worker thread instead of the
// test's own event loop.
//
// Why: a regression that reintroduces unbounded async recursion on a Kids
// cycle floods the microtask queue forever. Per the JS event-loop spec, all
// pending microtasks run to completion before the next macrotask, so an
// in-process `setTimeout` guard (e.g. Promise.race) can NEVER fire once that
// happens - it starves along with everything else. This was verified
// empirically against the pre-fix implementation: the process required an
// external SIGTERM and produced zero output, even past its own Playwright
// test timeout.
//
// worker.terminate(), called from the PARENT's own separate, unaffected
// event loop, is the one mechanism that reliably interrupts a starved
// worker instead of hanging the suite - also verified empirically.
import { parentPort } from 'node:worker_threads';
import { isDict, isRef, bytesFrom } from '../../src/io/pdf-lexer.ts';
import type { PdfDict, PdfObject, PdfValue } from '../../src/io/pdf-lexer.ts';
import type { PDFDoc } from '../../src/io/pdf-document.ts';
import { readAcroFields } from '../../src/io/pdf-acroform.ts';

const str = (s: string): PdfValue => ({ str: bytesFrom(s) });
const name = (n: string): PdfValue => ({ name: n });
const ref = (n: number): PdfValue => ({ ref: n, gen: 0 });

// A.Kids = [B], B.Kids = [A]: a structural cycle in /Kids, not a reference
// cycle - each hop resolves cleanly to a real dict, so PDFDoc.resolve's own
// 64-hop guard never sees it. C is a sibling, non-cyclic control field.
const fieldA: PdfDict = new Map([
  ['T', str('A')],
  ['FT', name('Tx')],
  ['Kids', [ref(2)]],
]);
const fieldB: PdfDict = new Map([
  ['T', str('B')],
  ['FT', name('Tx')],
  ['Kids', [ref(1)]],
]);
const fieldC: PdfDict = new Map([
  ['T', str('C')],
  ['FT', name('Tx')],
]);

const store = new Map<number, PdfDict>([
  [1, fieldA],
  [2, fieldB],
  [3, fieldC],
]);

const acroForm: PdfDict = new Map([['Fields', [ref(1), ref(3)]]]);
const catalog: PdfDict = new Map([['AcroForm', acroForm]]);
const trailer: PdfDict = new Map([['Root', catalog]]);

// A minimal fake exposing only the surface readAcroFields actually calls:
// trailer, resolve, resolveDict. Refs are looked up in `store`; anything
// else (an already-inline dict) is returned as-is, mirroring PDFDoc.resolve.
const resolve = async (value: PdfObject | undefined): Promise<PdfObject | null> => {
  if (value === undefined || value === null) return null;
  if (isRef(value)) return store.get(value.ref) ?? null;
  return value;
};
const resolveDict = async (value: PdfObject | undefined): Promise<PdfDict | null> => {
  const v = await resolve(value);
  return isDict(v) ? v : null;
};
const fakeDoc = { trailer, resolve, resolveDict } as unknown as PDFDoc;

readAcroFields(fakeDoc)
  .then((fields) => {
    parentPort?.postMessage({ ok: true, size: fields.size, hasC: fields.has('C') });
  })
  .catch((error: unknown) => {
    parentPort?.postMessage({ ok: false, error: String(error) });
  });
