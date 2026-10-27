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
  /**
   * Editing semantics of this attr as an inline MARK (see {@link MarkSpec}).
   * Absent on a registered interpreter = plain character formatting (inclusive,
   * exclusive, not atomic, kept on copy).
   */
  readonly mark?: MarkSpec;
}

/** DOM hints a mark contributes to its run in the digital (DOM) backend. */
export interface MarkDom {
  readonly class?: string;
  readonly attributes?: Readonly<Record<string, string>>;
}

/**
 * Editing semantics of an inline mark — an inline attr that is not (only)
 * formatting, e.g. a host `mention` carrying a record reference. Formatting
 * operations (bold, clear formatting, …) never merge or drop a mark: they only
 * touch their own keys.
 *
 * - `inclusive` (default `false`): typing at the mark's edge extends it. Built-in
 *   formatting is inclusive; `link` is not (Google Docs / Word: typing after a
 *   link does not extend it). Typing strictly INSIDE a mark always takes it.
 * - `exclusive` (default `true`): one value per run. `false` lets several
 *   instances of the type overlap: each instance is stored under its own attr key
 *   {@link markInstanceKey}(type, value), so overlapping instances never merge.
 * - `atomic` (default `false`): the range edits as one unit — the caret never
 *   rests inside it, a delete touching part of it removes all of it, typing
 *   never extends it.
 * - `copy` (default `"keep"`): `"drop"` strips the mark from copied content.
 * - `toDom(value)`: class / attributes the DOM backend puts on the run.
 */
export interface MarkSpec {
  readonly inclusive?: boolean;
  readonly exclusive?: boolean;
  readonly atomic?: boolean;
  readonly copy?: "keep" | "drop";
  toDom?(value: unknown): MarkDom;
}

/** Separator between a non-exclusive mark type and its instance identity. */
export const MARK_INSTANCE_SEPARATOR = "#";

/** Deterministic JSON (object keys sorted) — an instance key must not depend on key order. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    return `{${Object.keys(rec)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(rec[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * The attr key one instance of a NON-exclusive mark type is stored under:
 * `type#<canonical JSON of value>`. Equal values share a key (and so merge into one
 * range); different values are different keys (so they overlap independently).
 */
export function markInstanceKey(type: string, value: unknown): string {
  return `${type}${MARK_INSTANCE_SEPARATOR}${canonicalJson(value)}`;
}

/** The mark type an attr key belongs to: the key itself, or the type of an instance key. */
export function markTypeOf(attrKey: string): string {
  const i = attrKey.indexOf(MARK_INSTANCE_SEPARATOR);
  return i > 0 ? attrKey.slice(0, i) : attrKey;
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

  private atomicCount = 0;
  private dropCount = 0;

  register(interpreter: AttrInterpreter): void {
    const old = this.interpreters.get(interpreter.attrKey);
    if (old?.mark?.atomic === true) this.atomicCount--;
    if (old?.mark?.copy === "drop") this.dropCount--;
    this.interpreters.set(interpreter.attrKey, interpreter);
    if (interpreter.mark?.atomic === true) this.atomicCount++;
    if (interpreter.mark?.copy === "drop") this.dropCount++;
  }

  has(attrKey: string): boolean {
    return this.get(attrKey) !== undefined;
  }

  /**
   * The interpreter for `attrKey`. An instance key of a NON-exclusive mark
   * (`type#…`, see {@link markInstanceKey}) resolves to its type's interpreter.
   */
  get(attrKey: string): AttrInterpreter | undefined {
    const exact = this.interpreters.get(attrKey);
    if (exact !== undefined) return exact;
    const type = markTypeOf(attrKey);
    if (type === attrKey) return undefined;
    const base = this.interpreters.get(type);
    return base?.mark?.exclusive === false ? base : undefined;
  }

  /**
   * True iff typing at an edge of `attrKey`'s range extends it. Unregistered keys
   * are not inclusive; a registered interpreter without a mark spec is plain
   * formatting and is; an atomic mark never is.
   */
  isInclusive(attrKey: string): boolean {
    const interpreter = this.get(attrKey);
    if (interpreter === undefined) return false;
    const mark = interpreter.mark;
    if (mark === undefined) return true;
    return mark.inclusive === true && mark.atomic !== true;
  }

  isAtomic(attrKey: string): boolean {
    return this.get(attrKey)?.mark?.atomic === true;
  }

  /** True when copied content must not carry `attrKey`. */
  dropsOnCopy(attrKey: string): boolean {
    return this.get(attrKey)?.mark?.copy === "drop";
  }

  /** Fast-path guards: does any registered mark need atomic / copy-drop handling? */
  hasAtomicMarks(): boolean {
    return this.atomicCount > 0;
  }

  hasCopyDropMarks(): boolean {
    return this.dropCount > 0;
  }

  /** DOM hints from every mark in `attrs` whose spec has `toDom` (attrs order). */
  markDom(attrs: ReadonlyAttrs): readonly MarkDom[] | undefined {
    let out: MarkDom[] | undefined;
    for (const key of Object.keys(attrs)) {
      const toDom = this.get(key)?.mark?.toDom;
      if (toDom === undefined) continue;
      (out ??= []).push(toDom(attrs[key]));
    }
    return out;
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
      const interpreter = this.get(key);
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

/**
 * Register a host inline mark type `key` with its editing semantics (see
 * {@link MarkSpec}) and optional visuals (`toStyle`, used by every backend) /
 * custom run-merge equality (`equals`).
 */
export function registerMark(
  registry: AttrRegistry,
  key: string,
  spec: MarkSpec & {
    toStyle?(value: unknown, ctx?: CascadeContext): Partial<Style>;
    equals?(a: unknown, b: unknown): boolean;
  },
): void {
  if (key.includes(MARK_INSTANCE_SEPARATOR)) {
    throw new Error(`registerMark: mark type "${key}" must not contain "${MARK_INSTANCE_SEPARATOR}"`);
  }
  const { toStyle, equals, ...mark } = spec;
  registry.register({
    attrKey: key,
    toStyle: toStyle ?? (() => ({})),
    ...(equals !== undefined ? { equals } : {}),
    mark,
  });
}
