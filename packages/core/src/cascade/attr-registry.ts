import type { Style } from "../styles";
import type { ReadonlyAttrs } from "../state/attrs";

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
}
