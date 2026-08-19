/**
 * Schritt VI — Vor- und Nachteile. 235 Vorteile, 162 Nachteile, durchsuchbar und je nach
 * `Typ` gruppiert. Jede Zeile zeigt ihre `BasisKosten` und den echten `Regel`-Text
 * (`erzeugeRegelKarte`, hinter einem `<details>`, damit nicht 397 Fließtexte auf einmal
 * offen liegen). Einträge mit `Liste` bieten ihre Unteroptionen über ein Auswahlfeld an und
 * erlauben mehrere gleichzeitige Instanzen (z. B. mehrere „Kontakt"-Einträge); Einträge mit
 * gestuften `BasisKosten` (z. B. "6/24") bieten eine Stufenwahl.
 *
 * Die 80-AP-Deckel (`MAX_VORTEIL_AP`/`MAX_NACHTEIL_AP`, siehe core/limits.ts) werden über
 * `apKonto()` geprüft — dessen `vorteilAP`/`nachteilAP` schließen die automatisch durch die
 * Spezies gewährten Einträge bereits mit ein (siehe apkonto.ts-Kommentar), genau wie es die
 * Regel verlangt. Verstöße erscheinen als Marginale, nicht nur als Zahl.
 *
 * Nachteil-`BasisKosten` sind im Datensatz NEGATIV gespeichert. Diese Datei negiert sie GENAU
 * EINMAL für die Anzeige (`Math.abs`, über `formatiereNachteilGewinn`) — nie zusätzlich, sonst
 * kippt das Vorzeichen zurück und ein Gewinn sähe wieder wie eine Kostenzeile aus.
 */
import { el, leeren, anhaengenGestaffelt } from '../../dom.ts';
import { erzeugeRegelKarte } from '../../ruleCard.ts';
import { erzeugeMarginale, erzeugePulsWaechter } from '../../marginale.ts';
import { mitVorzeichen } from '../../format.ts';
import { feldStr, feldStrArr, stufenKosten, stufenAnzahl } from '../../rohdaten.ts';
import { ladeDatensatz } from '../../../data/loader.ts';
import { apKonto } from '../../../core/apkonto.ts';
import { pruefeVorNachteile, MAX_VORTEIL_AP, MAX_NACHTEIL_AP } from '../../../core/limits.ts';
import type { DatensatzZeile } from '../../../data/loader.ts';
import type { GewaehlteEigenheit } from '../../../core/character.ts';
import type { Store } from '../../../state/store.ts';
import type { Schritt } from '../types.ts';

type Art = 'vorteil' | 'nachteil';

function formatiereVorteilKosten(kosten: number): string {
  return `${kosten} AP`;
}

/** Nachteil-Kosten sind negativ gespeichert — EINMAL auf den Betrag gebracht, nie zusätzlich
 *  negiert, und über `mitVorzeichen` immer mit sichtbarem "+" als Gewinn dargestellt. */
function formatiereNachteilGewinn(kosten: number): string {
  return `${mitVorzeichen(Math.abs(kosten))} AP`;
}

function formatiereKosten(art: Art, kosten: number): string {
  return art === 'vorteil' ? formatiereVorteilKosten(kosten) : formatiereNachteilGewinn(kosten);
}

function baueInstanzZeile(art: Art, basisKosten: string, name: string, store: Store, instanz: GewaehlteEigenheit): HTMLElement {
  const kosten = stufenKosten(basisKosten, instanz.stufe ?? 1);
  const bezeichnung = instanz.erweiterung ?? name;
  return el('li', { class: 'eigenheit-instanz' }, [
    el('span', {}, [instanz.stufe !== undefined ? `${bezeichnung} · Stufe ${instanz.stufe}` : bezeichnung]),
    el('span', { class: 'zahl' }, [formatiereKosten(art, kosten)]),
    el('button', {
      type: 'button', class: 'entfernen-knopf', 'aria-label': `${bezeichnung} entfernen`,
      onclick: () => {
        store.setze((h) => {
          const liste = (art === 'vorteil' ? h.vorteile : h.nachteile).filter((e) => e !== instanz);
          return art === 'vorteil' ? { ...h, vorteile: liste } : { ...h, nachteile: liste };
        });
      },
    }, ['×']),
  ]);
}

function baueEigenheitZeile(art: Art, zeile: DatensatzZeile, heldListe: readonly GewaehlteEigenheit[], store: Store): HTMLElement {
  const id = feldStr(zeile, 'ID');
  const name = feldStr(zeile, 'Name divers');
  const basisKosten = feldStr(zeile, 'BasisKosten');
  const regelText = feldStr(zeile, 'Regel');
  const listeOptionen = feldStrArr(zeile, 'Liste');
  const hatListe = listeOptionen.length > 0;
  const anzahl = stufenAnzahl(basisKosten);
  const hatStufen = anzahl > 1;
  const instanzen = heldListe.filter((e) => e.id === id);

  const stufeOptionen = (standardStufe: number): HTMLOptionElement[] =>
    Array.from({ length: anzahl }, (_v, idx) => {
      const s = idx + 1;
      const kosten = stufenKosten(basisKosten, s);
      return el('option', { value: String(s), selected: s === standardStufe }, [`Stufe ${s} (${formatiereKosten(art, kosten)})`]);
    });

  let stufeSelect: HTMLSelectElement | null = null;
  if (hatStufen) {
    const bestehendeStufe = !hatListe ? instanzen[0]?.stufe : undefined;
    stufeSelect = el(
      'select',
      {
        'data-testid': `${art}-${id}-stufe`, 'aria-label': `${name}, Stufe wählen`,
        onchange: hatListe ? undefined : (ev) => {
          const neueStufe = Number((ev.target as HTMLSelectElement).value);
          if (instanzen.length === 0) return;
          store.setze((h) => {
            const liste = (art === 'vorteil' ? h.vorteile : h.nachteile)
              .map((e) => (e.id === id ? { ...e, stufe: neueStufe } : e));
            return art === 'vorteil' ? { ...h, vorteile: liste } : { ...h, nachteile: liste };
          });
        },
      },
      stufeOptionen(bestehendeStufe ?? 1),
    );
  }

  const erweiterungSelect = hatListe
    ? el('select', { 'data-testid': `${art}-${id}-liste`, 'aria-label': `${name}, Option wählen` },
      listeOptionen.map((opt) => el('option', { value: opt }, [opt])))
    : null;

  const knopf = hatListe
    ? el('button', {
      type: 'button', class: 'stepper-knopf-breit', 'data-testid': `${art}-${id}-hinzufuegen`,
      onclick: () => {
        const erweiterung = erweiterungSelect !== null ? erweiterungSelect.value : undefined;
        const stufe = stufeSelect !== null ? Number(stufeSelect.value) : undefined;
        store.setze((h) => {
          const liste = art === 'vorteil' ? h.vorteile : h.nachteile;
          if (liste.some((e) => e.id === id && e.erweiterung === erweiterung)) return h;
          const eintrag: GewaehlteEigenheit = { id };
          if (stufe !== undefined) eintrag.stufe = stufe;
          if (erweiterung !== undefined) eintrag.erweiterung = erweiterung;
          const neueListe = [...liste, eintrag];
          return art === 'vorteil' ? { ...h, vorteile: neueListe } : { ...h, nachteile: neueListe };
        });
      },
    }, ['Hinzufügen'])
    : el('button', {
      type: 'button', class: 'stepper-knopf-breit', 'data-testid': `${art}-${id}`,
      'aria-pressed': instanzen.length > 0,
      onclick: () => {
        store.setze((h) => {
          const liste = art === 'vorteil' ? h.vorteile : h.nachteile;
          const vorhanden = liste.find((e) => e.id === id);
          let neueListe: GewaehlteEigenheit[];
          if (vorhanden !== undefined) {
            neueListe = liste.filter((e) => e.id !== id);
          } else {
            const eintrag: GewaehlteEigenheit = { id };
            if (stufeSelect !== null) eintrag.stufe = Number(stufeSelect.value);
            neueListe = [...liste, eintrag];
          }
          return art === 'vorteil' ? { ...h, vorteile: neueListe } : { ...h, nachteile: neueListe };
        });
      },
    }, [instanzen.length > 0 ? 'Entfernen' : 'Hinzufügen']);

  const headerKostenText = (() => {
    const stufe1 = stufenKosten(basisKosten, 1);
    if (!hatStufen) return formatiereKosten(art, stufe1);
    if (hatListe) return `ab ${formatiereKosten(art, stufe1)}`;
    const bestehend = instanzen[0];
    if (bestehend !== undefined) return formatiereKosten(art, stufenKosten(basisKosten, bestehend.stufe ?? 1));
    return `ab ${formatiereKosten(art, stufe1)}`;
  })();

  const instanzenListe = hatListe && instanzen.length > 0
    ? el('ul', { class: 'eigenheit-instanzen', 'data-testid': `${art}-${id}-instanzen` },
      instanzen.map((instanz) => baueInstanzZeile(art, basisKosten, name, store, instanz)))
    : null;

  return el('li', { class: 'eigenheit-zeile', 'data-eigenheit': id }, [
    el('div', { class: 'eigenheit-kopf' }, [
      el('span', { class: 'eigenheit-name' }, [name]),
      el('span', { class: 'eigenheit-kosten zahl', 'data-testid': `${art}-${id}-kosten` }, [headerKostenText]),
    ]),
    el('div', { class: 'eigenheit-steuerung' }, [stufeSelect, erweiterungSelect, knopf]),
    instanzenListe,
    el('details', { class: 'kultur-details' }, [
      el('summary', {}, ['Regel ansehen']),
      erzeugeRegelKarte(name, regelText),
    ]),
  ]);
}

function baueAbschnitt(
  art: Art, zeilen: ReadonlyArray<DatensatzZeile>, heldListe: readonly GewaehlteEigenheit[], suchtext: string, store: Store,
): readonly HTMLElement[] {
  const suche = suchtext.trim().toLowerCase();
  const gefiltert = zeilen.filter((z) => suche === '' || feldStr(z, 'Name divers').toLowerCase().includes(suche));

  const gruppen = new Map<string, DatensatzZeile[]>();
  for (const z of gefiltert) {
    const typ = feldStr(z, 'Typ') || 'Sonstige';
    const bestehende = gruppen.get(typ);
    if (bestehende !== undefined) bestehende.push(z);
    else gruppen.set(typ, [z]);
  }

  const typNamen = [...gruppen.keys()].sort((a, b) => a.localeCompare(b, 'de'));
  if (typNamen.length === 0) return [el('p', { class: 'leere-liste-hinweis' }, ['Nichts gefunden.'])];

  return typNamen.map((typ) => {
    const eintraege = (gruppen.get(typ) ?? []).slice()
      .sort((a, b) => feldStr(a, 'Name divers').localeCompare(feldStr(b, 'Name divers'), 'de'));
    return el('div', { class: 'eigenheit-gruppe' }, [
      el('h4', { class: 'unterabschnitt-titel' }, [`${typ} (${eintraege.length})`]),
      el('ul', { class: 'eigenheit-liste' }, eintraege.map((z) => baueEigenheitZeile(art, z, heldListe, store))),
    ]);
  });
}

export const schrittVorNachteile: Schritt = {
  id: 'vornachteile',
  titel: 'Vor- und Nachteile',

  // Der Schritt-Vertrag übergibt istAbgeschlossen() nur `held`, ohne Datensatz-Zugriff — ohne
  // die BasisKosten-Nachschlagetabelle lässt sich der 80-AP-Deckel hier nicht prüfen (dieselbe
  // Einschränkung wie bei einer unaufgelösten EW-Wahl in spezies.ts). Die eigentliche Prüfung
  // läuft im Schritt selbst über `apKonto`/`pruefeVorNachteile` und zeigt sich als Marginale;
  // "abgeschlossen" heißt hier nur "betretbar" — Vor-/Nachteile sind ohnehin optional.
  istAbgeschlossen: () => true,

  render(container, { store, daten }) {
    const pulsWaechter = erzeugePulsWaechter();
    let vorteilZeilen: ReadonlyArray<DatensatzZeile> | null = null;
    let nachteilZeilen: ReadonlyArray<DatensatzZeile> | null = null;
    let suchtext = '';

    const suchfeld = el('input', {
      class: 'suchfeld', type: 'search', 'data-testid': 'vornachteile-suche',
      placeholder: 'Vor- oder Nachteil suchen …',
      oninput: (ev) => { suchtext = (ev.target as HTMLInputElement).value; renderInhalt(); },
    });

    const summenZeile = el('div', { class: 'eigenschaften-summe', 'data-testid': 'vornachteile-summe' });
    const summenMarginaleSlot = el('div', {});
    const vorteilInhalt = el('div', { class: 'eigenheit-abschnitt', 'data-testid': 'vorteile-liste' });
    const nachteilInhalt = el('div', { class: 'eigenheit-abschnitt', 'data-testid': 'nachteile-liste' });

    const abschnitt = el('section', { class: 'abschnitt' }, [
      el('h2', { class: 'abschnitt-titel' }, ['Vor- und Nachteile']),
      el('p', { class: 'abschnitt-untertitel' }, [
        `Höchstens ${MAX_VORTEIL_AP} AP dürfen in Vorteile fließen, höchstens ${MAX_NACHTEIL_AP} AP ` +
        'aus Nachteilen gewonnen werden — automatisch durch die Spezies gewährte Einträge zählen in ' +
        'beide Deckel mit hinein.',
      ]),
      el('label', { class: 'sr-only', for: 'vornachteile-suche' }, ['Vor- oder Nachteil suchen']),
      suchfeld,
      summenZeile,
      summenMarginaleSlot,
      el('h3', { class: 'unterabschnitt-titel' }, ['Vorteile']),
      vorteilInhalt,
      el('h3', { class: 'unterabschnitt-titel' }, ['Nachteile']),
      nachteilInhalt,
    ]);
    anhaengenGestaffelt(container, [abschnitt]);

    function renderInhalt(): void {
      const held = store.held();
      leeren(vorteilInhalt);
      leeren(nachteilInhalt);

      if (vorteilZeilen === null || nachteilZeilen === null) {
        vorteilInhalt.append(el('p', { class: 'leere-liste-hinweis' }, ['Datensätze laden …']));
        return;
      }

      vorteilInhalt.append(...baueAbschnitt('vorteil', vorteilZeilen, held.vorteile, suchtext, store));
      nachteilInhalt.append(...baueAbschnitt('nachteil', nachteilZeilen, held.nachteile, suchtext, store));

      const konto = apKonto(held, daten);
      leeren(summenZeile);
      summenZeile.append(
        el('span', {}, [
          'Vorteile: ',
          el('strong', { class: 'zahl', 'data-testid': 'vornachteile-vorteil-summe' }, [String(konto.vorteilAP)]),
          ` / ${MAX_VORTEIL_AP} AP`,
        ]),
        el('span', {}, [
          'Nachteile: ',
          el('strong', { class: 'zahl', 'data-testid': 'vornachteile-nachteil-summe' }, [String(konto.nachteilAP)]),
          ` / ${MAX_NACHTEIL_AP} AP`,
        ]),
      );

      leeren(summenMarginaleSlot);
      for (const problem of pruefeVorNachteile({ vorteilAP: konto.vorteilAP, nachteilAP: konto.nachteilAP })) {
        summenMarginaleSlot.append(
          erzeugeMarginale(problem.text, 'verletzung', { gepulst: pulsWaechter.istErstesErscheinen(problem.code) }),
        );
      }
    }

    renderInhalt();
    const abbestellen = store.abonniere(renderInhalt);

    void Promise.all([ladeDatensatz('vorteile'), ladeDatensatz('nachteile')]).then(([vorteile, nachteile]) => {
      vorteilZeilen = vorteile;
      nachteilZeilen = nachteile;
      renderInhalt();
    });

    return () => abbestellen();
  },
};
