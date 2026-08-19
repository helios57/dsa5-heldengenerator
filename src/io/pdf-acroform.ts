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
