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
    // These become properties of the vm context's global object, which is what
    // unqualified top-level `this` resolves to inside loaded scripts (see comment
    // above) — so `this.getField(...)` etc. reach these, not a dead `sandbox.this`.
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
