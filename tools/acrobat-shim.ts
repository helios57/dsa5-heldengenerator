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
 * Inside a vm context, unqualified top-level `this` resolves to the context's global
 * object (verified: `this === globalThis` inside the context), NOT to a property
 * literally named `"this"` on the sandbox. So the host members (`getField`,
 * `numFields`, `getNthFieldName`, `calculate`, `calculateNow`) are assigned directly
 * onto the sandbox object itself, which becomes that global object — that is what
 * makes `this.getField(...)` etc. resolve inside loaded scripts.
 * The `*GetInfo` lookup functions never depend on real field values, so an inert stub
 * suffices; scripts that fail to load either aren't valid JS on their own (e.g. HTML
 * fragments) or need Acrobat host features this stub does not provide (e.g. dialogs).
 *
 * One field is the exception: `DokumentSprache()` reads the `Sprachversion` field and
 * falls back to `'DE'` only `if (fFeld != null)` is false — but an inert stub field is
 * never `null`, so that guard never trips, and the empty-string default value wins
 * instead of the intended `'DE'` fallback. Several `*GetInfo` lookups (e.g. `IDSpezies`
 * via `SpeziesGetInfo`'s `Name Plural`) pass that language straight into a `switch` with
 * no `''` case, so they silently fall through to a numeric/empty default. Named field
 * defaults below patch specific fields to the value Acrobat would realistically hold;
 * every other field name keeps the original inert stub.
 */
const NAMED_FIELD_DEFAULTS: Readonly<Record<string, string>> = {
  Sprachversion: 'DE',
};

export function createRulesContext(scriptDir: string): RulesContext {
  const makeField = (value: string) => ({
    value,
    valueAsString: value,
    numItems: 0,
    display: 0,
    getItemAt: () => '',
    buttonGetCaption: () => '',
    setAction() {},
    setItems() {},
    clearItems() {},
  });
  const field = makeField('');
  const namedFields = new Map(
    Object.entries(NAMED_FIELD_DEFAULTS).map(([name, value]) => [name, makeField(value)]),
  );

  const sandbox: Record<string, unknown> = {
    console, JSON, Math, Date,
    parseInt, parseFloat, String, Number, Array, Object, RegExp, isNaN,
    app: { alert() {}, popUpMenu: () => null },
    util: { printf: (...a: unknown[]) => a.join(''), printd: () => '' },
    event: {},
    color: {},
    display: { visible: 0, hidden: 1 },
    // These become properties of the vm context's global object, which is what
    // unqualified top-level `this` resolves to inside loaded scripts (see comment
    // above) — so `this.getField(...)` etc. reach these, not a dead `sandbox.this`.
    getField: (name: string) => namedFields.get(name) ?? field,
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
