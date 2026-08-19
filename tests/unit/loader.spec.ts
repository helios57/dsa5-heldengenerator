import { test, expect } from '@playwright/test';
import { ladeDatensatz, baueDatenIndex, setzeBasisPfad } from '../../src/data/loader.ts';

// Diese Suite stubbt `fetch` komplett — nie Netzwerk oder Dateisystem berühren. Jeder Test, der
// `ladeDatensatz` direkt aufruft, verwendet einen eigenen, in der gesamten Datei sonst
// unbenutzten Datensatznamen: `ladeDatensatz` cached modulweit (Map auf Modulebene), und
// Playwright kann Tests derselben Datei im selben Worker-Prozess (also mit geteiltem
// Modul-Cache) ausführen. Verschiedene Namen pro Test schließen jede Cache-Überschneidung
// unabhängig von der Ausführungsreihenfolge aus. `baueDatenIndex` bekommt exklusiv die neun
// Namen, die es intern tatsächlich lädt (spezies/kulturen/professionen/talente/
// kampftechniken/vorteile/nachteile/zauber/liturgien); alle anderen Tests verwenden je einen
// der acht übrigen Namen (sprachen/traditionen/eigenschaften/sf_allgemein/sf_kampf/
// sf_magisch/sf_karmal/ausruestung) und rühren diese neun daher nie an.

const echtesFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = echtesFetch;
  setzeBasisPfad('./data/');
});

function installiereFetch(antwortFuer: (url: string) => Response): string[] {
  const aufgerufeneUrls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    aufgerufeneUrls.push(url);
    return antwortFuer(url);
  }) as typeof fetch;
  return aufgerufeneUrls;
}

function jsonAntwort(daten: unknown, status = 200): Response {
  return new Response(JSON.stringify(daten), { status });
}

test('lädt relativ zum Dokument (./data/<name>.json), niemals absolut', async () => {
  const aufrufe = installiereFetch(() => jsonAntwort([{ Name: 'Garethi', Max: '3' }]));
  const zeilen = await ladeDatensatz('sprachen');
  expect(aufrufe).toEqual(['./data/sprachen.json']);
  expect(zeilen).toEqual([{ Name: 'Garethi', Max: '3' }]);
});

test('cached nach dem ersten Laden — ein zweiter Aufruf feuert keine weitere Anfrage', async () => {
  const aufrufe = installiereFetch(() => jsonAntwort([{ Name: 'Kosch', Faktor: '1' }]));
  const erster = await ladeDatensatz('traditionen');
  const zweiter = await ladeDatensatz('traditionen');
  expect(aufrufe.length).toBe(1);
  expect(zweiter).toBe(erster); // dieselbe Referenz, nicht nur inhaltsgleich
});

test('parallele Anfragen für denselben Datensatz teilen sich EINE laufende Anfrage', async () => {
  const aufrufe = installiereFetch(() => jsonAntwort([{ ID: 'Eig1', Kurz: 'MU' }]));
  const [a, b, c] = await Promise.all([
    ladeDatensatz('eigenschaften'), ladeDatensatz('eigenschaften'), ladeDatensatz('eigenschaften'),
  ]);
  expect(aufrufe.length).toBe(1);
  expect(a).toBe(b);
  expect(b).toBe(c);
});

test('setzeBasisPfad überschreibt den Basispfad, bleibt aber relativ', async () => {
  setzeBasisPfad('./unterordner/data');
  const aufrufe = installiereFetch(() => jsonAntwort([]));
  await ladeDatensatz('sf_allgemein');
  expect(aufrufe).toEqual(['./unterordner/data/sf_allgemein.json']);
});

test('wirft eine klare deutsche Fehlermeldung bei einem Netzwerkfehler', async () => {
  globalThis.fetch = (async () => {
    throw new Error('getrennt');
  }) as typeof fetch;
  await expect(ladeDatensatz('sf_kampf')).rejects.toThrow(/Datensatz "sf_kampf".*nicht geladen/);
});

test('wirft eine klare deutsche Fehlermeldung bei HTTP-Fehlerstatus, und ein späterer Erfolg cached nicht den Fehler', async () => {
  let versuch = 0;
  installiereFetch(() => {
    versuch++;
    if (versuch === 1) return new Response('Nicht gefunden', { status: 404 });
    return jsonAntwort([{ 'Name divers': 'Bannzone' }]);
  });
  await expect(ladeDatensatz('sf_magisch')).rejects.toThrow(/Datensatz "sf_magisch".*Status 404/);
  const zeilen = await ladeDatensatz('sf_magisch');
  expect(versuch).toBe(2); // fehlgeschlagener Versuch wurde nicht gecacht, es wurde erneut geladen
  expect(zeilen).toEqual([{ 'Name divers': 'Bannzone' }]);
});

test('wirft eine klare deutsche Fehlermeldung bei kaputtem JSON', async () => {
  installiereFetch(() => new Response('{ das ist kein json', { status: 200 }));
  await expect(ladeDatensatz('sf_karmal')).rejects.toThrow(/Datensatz "sf_karmal".*JSON/);
});

test('wirft eine klare deutsche Fehlermeldung, wenn die JSON-Form kein Array von Objekten ist', async () => {
  installiereFetch(() => jsonAntwort({ das: 'ist kein Array' }));
  await expect(ladeDatensatz('ausruestung')).rejects.toThrow(/Datensatz "ausruestung".*unerwartetes Format/);
});

test('baueDatenIndex lädt genau die neun benötigten Kategorien und indiziert sie korrekt', async () => {
  const datenNachName: Record<string, unknown[]> = {
    spezies: [{ ID: 'S1', 'Name Plural': 'Menschen', AP: 0 }],
    kulturen: [{ ID: 'K1', Gesamt: '10' }],
    professionen: [{ 'Name divers': 'Achazschaman:in', Gesamt: '322+130' }],
    talente: [{ ID: 'Tal1', SF: 'B' }],
    kampftechniken: [{ Name: 'Dolche', SF: 'D' }],
    vorteile: [{ ID: 'VT1', BasisKosten: '5' }],
    nachteile: [{ ID: 'NT1', BasisKosten: '-5' }],
    zauber: [{ ID: 'ZAU1', SF: 'A' }],
    liturgien: [{ ID: 'LIT1', SF: 'A' }],
  };
  const erwarteteNamen = Object.keys(datenNachName);
  const aufrufe = installiereFetch((url) => {
    const name = erwarteteNamen.find((n) => url.includes(`/${n}.json`));
    if (name === undefined) throw new Error(`unerwartete URL im Test: ${url}`);
    return jsonAntwort(datenNachName[name]);
  });

  const index = await baueDatenIndex();

  // genau die neun erwarteten Kategorien wurden geladen — insbesondere NICHT die (großen)
  // Sonderfertigkeiten- oder Ausrüstungs-Datensätze
  expect([...aufrufe].sort()).toEqual(erwarteteNamen.map((n) => `./data/${n}.json`).sort());
  expect(aufrufe.some((u) => u.includes('ausruestung'))).toBe(false);
  expect(aufrufe.some((u) => u.includes('sf_'))).toBe(false);

  expect(index.spezies.get('S1')).toMatchObject({ AP: 0 });
  expect(index.kulturen.get('K1')).toMatchObject({ Gesamt: '10' });
  // professionen hat kein 'ID'-Feld im Datensatz — indiziert über 'Name divers'
  expect(index.professionen.get('Achazschaman:in')).toMatchObject({ Gesamt: '322+130' });
  expect(index.talente.get('Tal1')).toMatchObject({ SF: 'B' });
  // kampftechniken hat ebenfalls kein 'ID'-Feld — indiziert über 'Name'
  expect(index.kampftechniken.get('Dolche')).toMatchObject({ SF: 'D' });
  expect(index.vorteile.get('VT1')).toMatchObject({ BasisKosten: '5' });
  expect(index.nachteile.get('NT1')).toMatchObject({ BasisKosten: '-5' });
  expect(index.zauber.get('ZAU1')).toMatchObject({ SF: 'A' });
  expect(index.liturgien.get('LIT1')).toMatchObject({ SF: 'A' });
});
