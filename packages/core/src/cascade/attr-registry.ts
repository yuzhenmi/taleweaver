import type { Style } from "../styles";
import type { ReadonlyAttrs } from "../state";
import { registerBuiltinAttrs } from "./builtin-attrs";

/**
 * An interpreter for one attribute key. Translates the open-schema
 * attribute value into a Partial<Style> contribution. The cascade pass
 * merges these contributions and runs em/rem resolution + inheritance +
 * defaults to produce the closed ComputedStyle.
 *
 * `equals` is optional: when present, it overrides default deep value
 * equality for run-merging compares (used by the inline-content normalizer
 * to decide if two adjacent text items have equivalent attrs). Most
 * interpreters don't need this; rare cases (e.g. a `comment` attribute
 * whose `timestamp` field shouldn't affect compare) can opt in.
 */
export interface AttrInterpreter {
  readonly attrKey: string;
  toStyle(value: unknown, ctx?: CascadeContext): Partial<Style>;
  equals?(a: unknown, b: unknown): boolean;
}

/**
 * Cascade context — passed to interpreters that need information about
 * the surrounding cascade state.
 *
 * Phase 3 ships the minimal `parentStyle` field (the resolved declarable
 * style of the parent block, useful for explicit inheritance flags). Later
 * phases will extend this for more sophisticated needs:
 *   - currentColor (needs own resolved color)
 *   - em-relative sizing (needs own parent fontSize after resolution)
 *   - root-relative units (needs root style)
 *   - writing-mode-relative direction
 */
export interface CascadeContext {
  readonly parentStyle?: Partial<Style>;
}

/**
 * Registry of attribute interpreters, keyed by attrKey. Production code
 * uses the default singleton instance `attrRegistry`; tests can construct
 * their own instances to avoid global-state bleed.
 *
 * Re-registering the same key replaces the previous interpreter (the
 * built-in `bold` can be overridden by a plugin's stronger version).
 */
export class AttrRegistry {
  private readonly interpreters = new Map<string, AttrInterpreter>();

  register(interpreter: AttrInterpreter): void {
    this.interpreters.set(interpreter.attrKey, interpreter);
  }

  has(attrKey: string): boolean {
    return this.interpreters.has(attrKey);
  }

  get(attrKey: string): AttrInterpreter | undefined {
    return this.interpreters.get(attrKey);
  }

  /**
   * Run interpreters for each key in `attrs` (in attrs-object iteration
   * order, which is insertion order for plain objects). Merge contributions
   * into a single Partial<Style>. Later attrs keys override earlier ones
   * for the same Style property — this matches authorial intent ("the last
   * value wins") and is plugin-stable (registering a new interpreter
   * doesn't shift the cascade order of unrelated existing attrs).
   *
   * Keys with no registered interpreter are skipped silently.
   */
  applyAll(attrs: ReadonlyAttrs, ctx?: CascadeContext): Partial<Style> {
    const out: Partial<Style> = {};
    for (const key of Object.keys(attrs)) {
      const interpreter = this.interpreters.get(key);
      if (!interpreter) continue;
      const contribution = interpreter.toStyle(attrs[key], ctx);
      Object.assign(out, contribution);
    }
    return out;
  }
}

/**
 * Default registry instance. Production code registers built-in
 * interpreters here on import (see `builtin-attrs.ts`); plugins can
 * register additional interpreters at runtime. Tests that need
 * isolation should construct their own `new AttrRegistry()`.
 */
export const attrRegistry = new AttrRegistry();

/**
 * Construct a fresh `AttrRegistry` pre-populated with every built-in
 * attribute interpreter. Canonical production wiring (P7+): callers
 * inject the returned registry into `render(state, componentRegistry,
 * attrRegistry)` so cascade interpreters actually contribute to
 * `ComputedStyle`.
 *
 * Tests that want isolation can instantiate `new AttrRegistry()` and
 * register only the interpreters under test.
 *
 * See Decision G in docs/superpowers/specs/phase-5-plus/decisions.md.
 */
export function createDefaultAttrRegistry(): AttrRegistry {
  const reg = new AttrRegistry();
  registerBuiltinAttrs(reg);
  return reg;
}
