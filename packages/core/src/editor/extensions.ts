import { resolveBlock, createPosition, createSpan, positionsEqual } from "../state";
import type { Position, State, BlockId } from "../state";
import { isCollapsed } from "../cursor/selection";
import { transitionMapping } from "../decorations/decoration-layers";
import type { EditorAction } from "./editor-action";
import type { EditorConfig } from "./editor-config";
import type { EditorState } from "./editor-state";
import type { AttrRegistry } from "../cascade/attr-registry";
import type { ComponentRegistry } from "../components/component-registry";
import { isObjectSelection } from "../cursor/object-selection";

/**
 * Host extension API: commands, keymap, input rules and triggers. Converges on the
 * word-processor / editor-framework consensus (ProseMirror commands + keymap + input
 * rules + the "suggestion" trigger utility, Lexical's host-before-default command
 * priority, Word / Google Docs autocorrect undo). See `docs/architecture/1-core/1.5-editor.md`
 * "Host extensions".
 */

/** The live view a `TRANSACTION`'s `run` works against. */
export interface Transaction {
  /** The editor after every step dispatched so far. */
  readonly editor: EditorState;
  /**
   * Apply one action through the reducer, inside the transaction's single undo entry.
   * Throws (before applying) for an action that cannot be a step — UNDO / REDO, a peer's
   * `APPLY_FOREIGN_CHANGE` (untracked), a `PROPOSE` (another author's change: untracked, or its own undo
   * entry and verdict, never merged into the user's transaction).
   */
  dispatch(action: EditorAction): void;
}

/**
 * A host command (ProseMirror signature). Called WITHOUT `dispatch` it only answers
 * "can it run here?"; with `dispatch` it runs. A command made of several engine steps
 * dispatches ONE `TRANSACTION` so they are one undo step. Commands run in the
 * controller (not the reducer), so they may also drive host UI.
 */
export type Command = (editor: EditorState, dispatch?: (action: EditorAction) => void) => boolean;

/** A key binding's target: a command, a command NAME (see `commands`), or `null` = unbound. */
export type KeyBinding = Command | string | null;

/** The range an input rule matched (text before the caret, in one block). */
export interface InputRuleRange {
  readonly from: Position;
  readonly to: Position;
}

/**
 * Pattern → transform on user-typed text. `pattern` is tested against the text before
 * the caret in its block (embeds read as U+FFFC) and must match up to the caret (anchor
 * it with `$`). `replace`: a string (typed over the match, keeping its formatting) or the
 * actions to run (one transaction). The transform is its own undo entry: one Undo
 * returns to the typed text.
 */
export interface InputRule {
  readonly pattern: RegExp;
  readonly replace: string | ((match: RegExpExecArray, range: InputRuleRange) => readonly EditorAction[]);
}

/** A typed trigger (`@`, `[[`) that opens a host picker while the user types a query. */
export interface TriggerSpec {
  readonly id: string;
  /** The trigger text the user types. */
  readonly text: string;
  /** Only at block start or after whitespace (default true — no trigger inside "a@b"). */
  readonly startOfWord?: boolean;
  /** Whether the query may contain spaces (default false: a space ends the trigger). */
  readonly allowSpaces?: boolean;
  /** Longest query before the trigger ends (default 64). */
  readonly maxQueryLength?: number;
}

/**
 * The trigger the user is typing: `from` = where the trigger text starts (mapped through
 * every edit, like an anchor), `to` = the caret (end of the query), `query` = the text
 * typed after the trigger.
 */
export interface ActiveTrigger {
  readonly id: string;
  readonly from: Position;
  readonly to: Position;
  readonly query: string;
}

/** Everything a host plugs into the editor (`EditorConfig.extensions`). */
export interface EditorExtensions {
  /** Named commands (runnable by name from the keymap and `controller.runCommand`). */
  readonly commands?: Readonly<Record<string, Command>>;
  /** Key bindings, consulted BEFORE the backend's defaults; `null` unbinds a default. */
  readonly keymap?: Readonly<Record<string, KeyBinding>>;
  readonly inputRules?: readonly InputRule[];
  readonly triggers?: readonly TriggerSpec[];
}

// ─── Transactions ─────────────────────────────────────────────────────────

/** The editor reducer, handed to the actions that run other actions (transactions, input rules). */
export type Reduce = (editor: EditorState, action: EditorAction) => EditorState;

/**
 * Run a `TRANSACTION`: every step goes through `reduce` inside ONE history batch (one
 * undo entry). The result's `lastDirtyIds` is the union of the steps' (null when any
 * step's extent is unknown); `lastChange` chains the steps.
 */
export function runTransaction(
  editor: EditorState,
  run: (tx: Transaction) => void,
  reduce: Reduce,
): EditorState {
  let current = editor;
  const dirty = new Set<BlockId>();
  let unknown = false;
  editor.history.beginBatch(editor.selection);
  let ok = false;
  try {
    run({
      get editor() {
        return current;
      },
      dispatch(action) {
        // Only undoable steps: a step that bypasses this History (UNDO / REDO, a peer's
        // change, another author's proposal) could not be rolled back with the rest, so it is refused
        // BEFORE it applies (the throw rolls back earlier steps). Suggestion accept /
        // reject are ordinary undoable steps.
        if (
          action.type === "UNDO" ||
          action.type === "REDO" ||
          action.type === "APPLY_FOREIGN_CHANGE" ||
          action.type === "PROPOSE"
        ) {
          throw new Error(
            `TRANSACTION: "${action.type}" is not undoable here and cannot be a transaction step`,
          );
        }
        const next = reduce(current, action);
        if (next.state !== current.state) {
          if (next.lastDirtyIds === null) unknown = true;
          else for (const id of next.lastDirtyIds) dirty.add(id);
        }
        current = next;
      },
    });
    ok = true;
  } finally {
    // A throwing step must not leave the document half-edited while the caller keeps
    // the old EditorState: roll the whole transaction back, then let the error escape.
    if (ok) editor.history.endBatch();
    else editor.history.abortBatch();
  }
  if (current.state === editor.state) return { ...current, lastDirtyIds: null };
  return { ...current, lastDirtyIds: unknown ? null : dirty };
}

/** Union of two dirty sets (`null` = unknown wins). */
export function unionDirty(
  a: ReadonlySet<BlockId> | null,
  b: ReadonlySet<BlockId> | null,
): ReadonlySet<BlockId> | null {
  if (a === null || b === null) return null;
  return new Set([...a, ...b]);
}

// ─── Text before the caret ────────────────────────────────────────────────

/** The block's text in `[from, to)` (embeds as U+FFFC). */
function blockText(state: State, blockId: BlockId, from: number, to: number): string {
  const items = resolveBlock(state, blockId)?.block.inlineContent?.items ?? [];
  let out = "";
  let pos = 0;
  for (const item of items) {
    if (pos >= to) break;
    const text = item.kind === "text" ? item.text : "￼";
    const end = pos + text.length;
    if (end > from) out += text.slice(Math.max(0, from - pos), Math.min(text.length, to - pos));
    pos = end;
  }
  return out;
}

const INPUT_RULE_WINDOW = 500;

// ─── Input rules ──────────────────────────────────────────────────────────

/**
 * After user-typed text: run the first input rule whose pattern matches up to the caret,
 * as its OWN undo entry (typing coalescing is broken first), so one Undo reverts just the
 * transform back to the typed text. Returns `editor` when no rule fires.
 */
export function applyInputRules(editor: EditorState, config: EditorConfig, reduce: Reduce): EditorState {
  const rules = config.extensions?.inputRules;
  if (rules === undefined || rules.length === 0 || !isCollapsed(editor.selection)) return editor;
  const caret = editor.selection.focus;
  const start = Math.max(0, caret.offset - INPUT_RULE_WINDOW);
  const before = blockText(editor.state, caret.blockId, start, caret.offset);
  for (const rule of rules) {
    rule.pattern.lastIndex = 0;
    const match = rule.pattern.exec(before);
    if (match === null || match.index + match[0].length !== before.length || match[0].length === 0) continue;
    const range: InputRuleRange = {
      from: createPosition(caret.blockId, start + match.index),
      to: caret,
    };
    const actions: readonly EditorAction[] =
      typeof rule.replace === "string"
        ? [
            { type: "SET_SELECTION", selection: createSpan(range.from, range.to) },
            { type: "INSERT_TEXT", text: rule.replace },
          ]
        : rule.replace(match, range);
    if (actions.length === 0) continue;
    editor.history.breakCoalescing();
    const next = reduce(editor, { type: "TRANSACTION", run: (tx) => actions.forEach((a) => tx.dispatch(a)) });
    if (next.state === editor.state && next.selection === editor.selection) continue;
    return { ...next, lastDirtyIds: unionDirty(editor.lastDirtyIds, next.lastDirtyIds) };
  }
  return editor;
}

// ─── Triggers ─────────────────────────────────────────────────────────────

/** What may precede a `startOfWord` trigger: whitespace or opening punctuation —
 *  brackets / quotes, Unicode Ps (open), Pi (initial quote), Pf (final quote, which
 *  some languages use as the opening one): "(@", "“@", "«@". */
const WORD_START_BEFORE = /^[\s\p{Ps}\p{Pi}\p{Pf}"']$/u;

/** The trigger at `from` in `editor`, if the text from it to the caret is still a valid one. */
/** True when any run in `[from, to)` of the block carries an atomic mark (a picked mention). */
function hasAtomicMark(state: State, blockId: BlockId, from: number, to: number, registry: AttrRegistry): boolean {
  if (!registry.hasAtomicMarks()) return false;
  let pos = 0;
  for (const item of resolveBlock(state, blockId)?.block.inlineContent?.items ?? []) {
    const end = pos + (item.kind === "text" ? item.text.length : 1);
    if (end > from && pos < to && Object.keys(item.attrs).some((k) => registry.isAtomic(k))) return true;
    if (end >= to) break;
    pos = end;
  }
  return false;
}

function validTrigger(spec: TriggerSpec, editor: EditorState, from: Position, registry: AttrRegistry): ActiveTrigger | undefined {
  const { selection, state } = editor;
  if (!isCollapsed(selection)) return undefined;
  const caret = selection.focus;
  if (caret.blockId !== from.blockId || caret.offset < from.offset + spec.text.length) return undefined;
  const text = blockText(state, caret.blockId, from.offset, caret.offset);
  if (!text.startsWith(spec.text)) return undefined;
  const query = text.slice(spec.text.length);
  if (query.includes("￼") || query.includes("\n")) return undefined;
  if (spec.allowSpaces !== true && /\s/.test(query)) return undefined;
  if (query.length > (spec.maxQueryLength ?? 64)) return undefined;
  // Text already turned into an atomic mark (a picked mention "@Anna") is never a
  // trigger again, even though it still spells one.
  if (hasAtomicMark(state, caret.blockId, from.offset, caret.offset, registry)) return undefined;
  return { id: spec.id, from, to: caret, query };
}

/** `next` unless it equals `prev` (same object kept so observers see no change). */
function stable(prev: ActiveTrigger | undefined, next: ActiveTrigger | undefined): ActiveTrigger | undefined {
  if (prev === undefined || next === undefined) return next;
  return prev.id === next.id &&
    prev.query === next.query &&
    positionsEqual(prev.from, next.from) &&
    positionsEqual(prev.to, next.to)
    ? prev
    : next;
}

/**
 * Maintain `EditorState.activeTrigger` across one action: map the active trigger's start
 * through the edit and re-validate it (it ends when the caret leaves it, the trigger text
 * is deleted, the query breaks the spec's rules, or on ESCAPE); a USER-typed insertion
 * that completes a trigger text at the caret starts one.
 */
export function updateActiveTrigger(
  before: EditorState,
  result: EditorState,
  action: EditorAction,
  config: EditorConfig,
): EditorState {
  // A transaction's steps are not separate edits: its intermediate selections (a step
  // moving the caret elsewhere) must not end the trigger — it is mapped and checked
  // once, across the whole transaction, when the outer action finishes.
  // ESCAPE inside a transaction (e.g. the last step of a pick) still ends it at once.
  if (result.history.batching) {
    return action.type === "ESCAPE" && result.activeTrigger !== undefined ? { ...result, activeTrigger: undefined } : result;
  }
  const specs = config.extensions?.triggers ?? [];
  const prev = result.activeTrigger;
  let next: ActiveTrigger | undefined;
  if (prev !== undefined && action.type !== "ESCAPE") {
    const spec = specs.find((s) => s.id === prev.id);
    let from: Position | null = prev.from;
    if (result.state !== before.state) {
      const mapped = transitionMapping(before, result).map(prev.from, 1);
      from = mapped.position;
    }
    if (spec !== undefined && from !== null) next = validTrigger(spec, result, from, config.attrRegistry);
  }
  if (next === undefined && action.type === "INSERT_TEXT" && action.userInput === true && isCollapsed(result.selection)) {
    // The trigger text must END inside the just-typed text (a keystroke completing
    // "@", or an IME commit "@あ" carrying trigger + query); the rest is the query.
    const caret = result.selection.focus;
    const typedStart = caret.offset - action.text.length;
    for (const spec of specs) {
      const windowStart = Math.max(0, typedStart - spec.text.length);
      const text = blockText(result.state, caret.blockId, windowStart, caret.offset);
      const idx = text.lastIndexOf(spec.text);
      if (idx < 0 || windowStart + idx + spec.text.length <= typedStart) continue;
      const start = windowStart + idx;
      if (spec.startOfWord !== false && start > 0) {
        const prevChar = blockText(result.state, caret.blockId, start - 1, start);
        if (!WORD_START_BEFORE.test(prevChar)) continue;
      }
      next = validTrigger(spec, result, createPosition(caret.blockId, start), config.attrRegistry);
      if (next !== undefined) break;
    }
  }
  next = stable(prev, next);
  return next === prev ? result : { ...result, activeTrigger: next };
}

/** How the active trigger changed between two editor states (for host pickers). */
export type TriggerChange =
  | { readonly type: "start"; readonly trigger: ActiveTrigger }
  | { readonly type: "update"; readonly trigger: ActiveTrigger }
  | { readonly type: "exit"; readonly trigger: ActiveTrigger };

export function triggerChange(prev: EditorState, next: EditorState): TriggerChange | null {
  const a = prev.activeTrigger;
  const b = next.activeTrigger;
  if (a === b) return null;
  if (b === undefined) return a === undefined ? null : { type: "exit", trigger: a };
  if (a === undefined || a.id !== b.id) return { type: "start", trigger: b };
  return { type: "update", trigger: b };
}

/**
 * The transaction replacing `range` (e.g. an active trigger's `from`..`to`) with `text`
 * carrying inline mark `mark`, then typing `suffix` after it — ONE undo step,
 * tracked like the equivalent typing in suggesting mode.
 */
export function replaceRangeWithMarkedText(
  range: { readonly from: Position; readonly to: Position },
  text: string,
  mark: { readonly key: string; readonly value: unknown },
  suffix = "",
): EditorAction {
  return {
    type: "TRANSACTION",
    run: (tx) => {
      tx.dispatch({ type: "SET_SELECTION", selection: createSpan(range.from, range.to) });
      tx.dispatch({ type: "INSERT_TEXT", text });
      const end = createPosition(range.from.blockId, range.from.offset + text.length);
      tx.dispatch({ type: "SET_MARK", key: mark.key, value: mark.value, span: createSpan(range.from, end) });
      tx.dispatch({ type: "SET_SELECTION", selection: createSpan(end, end) });
      if (suffix !== "") tx.dispatch({ type: "INSERT_TEXT", text: suffix });
      // The pick ends the trigger explicitly — the inserted text may itself spell one.
      tx.dispatch({ type: "ESCAPE" });
    },
  };
}

// ─── Keymap ───────────────────────────────────────────────────────────────

/** The key fields a binding is matched against (a DOM `KeyboardEvent` satisfies it). */
export interface KeyEventLike {
  readonly key: string;
  readonly code?: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  /** `KeyboardEvent.getModifierState` — used to recognise AltGr ("AltGraph"). */
  getModifierState?(key: string): boolean;
}

/** What `Mod` means: `"meta"` (Cmd, Apple platforms) or `"ctrl"` (elsewhere). */
export type ModConvention = "meta" | "ctrl";

/** `Mod` for a platform: Cmd on Apple platforms, Ctrl elsewhere (from a user-agent string). */
export function modConventionFor(userAgent: string): ModConvention {
  return /Mac|iPhone|iPad|iPod/i.test(userAgent) ? "meta" : "ctrl";
}

export interface ParsedBinding {
  readonly key: string;
  readonly mod: boolean;
  readonly ctrl: boolean;
  readonly meta: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
}

const isLetter = (k: string): boolean => k.length === 1 && k.toLowerCase() !== k.toUpperCase();

function normalizeKey(key: string): string {
  if (key === "Space" || key === "Spacebar") return " ";
  if (key === "Esc") return "Escape";
  return key.length === 1 ? key.toLowerCase() : key;
}

/** Parse "Mod-Shift-m" (modifier names case-insensitive; "Mod--" binds the "-" key). */
export function parseKeyBinding(name: string): ParsedBinding {
  const parts = name.split(/-(?!$)/);
  const rawKey = parts.pop();
  if (rawKey === undefined || rawKey === "") throw new Error(`parseKeyBinding: no key in "${name}"`);
  const flags = { mod: false, ctrl: false, meta: false, alt: false, shift: false };
  for (const part of parts) {
    const m = part.toLowerCase();
    if (m === "mod") flags.mod = true;
    else if (m === "ctrl" || m === "control" || m === "c") flags.ctrl = true;
    else if (m === "meta" || m === "cmd" || m === "m") flags.meta = true;
    else if (m === "alt" || m === "option" || m === "a") flags.alt = true;
    else if (m === "shift" || m === "s") flags.shift = true;
    else throw new Error(`parseKeyBinding: unknown modifier "${part}" in "${name}"`);
  }
  return { key: normalizeKey(rawKey), ...flags };
}

/** The physical letter / digit of `code` ("KeyB" → "b", "Digit1" → "1"), or null. */
function physicalKey(code: string | undefined): string | null {
  if (code === undefined) return null;
  const m = /^(?:Key([A-Z])|Digit([0-9]))$/.exec(code);
  if (m === null) return null;
  return (m[1] ?? m[2] ?? "").toLowerCase() || null;
}

function matches(b: ParsedBinding, e: KeyEventLike, mod: ModConvention): boolean {
  let key = normalizeKey(e.key);
  // A chord on a non-Latin layout (Ctrl+B on Cyrillic reports "и") or Alt on a Mac
  // (Alt-a → "å") produces a non-ASCII `key`: match the PHYSICAL key instead
  // (ProseMirror's convention), so shortcuts work on every layout.
  // Never for AltGr text input (Windows/Linux report AltGr as Ctrl+Alt): "ł" is a
  // character the user is typing, not Ctrl+Alt+L.
  // Elsewhere, trust the browser's AltGraph state when it reports one; only without
  // getModifierState fall back to the Ctrl+Alt-producing-a-character heuristic.
  // Apple platforms have no AltGr at all — some browsers (Firefox on macOS) still report
  // Option as "AltGraph" — so under the Apple convention it is never AltGr.
  const altGraph =
    mod === "meta"
      ? false
      : e.getModifierState !== undefined
        ? e.getModifierState("AltGraph")
        : e.ctrlKey && e.altKey && !e.metaKey && key.length === 1;
  if (!altGraph && (e.ctrlKey || e.metaKey || e.altKey) && key.length === 1 && key.charCodeAt(0) > 127) {
    key = physicalKey(e.code) ?? key;
  }
  if (key !== b.key) return false;
  if (b.alt !== e.altKey) return false;
  // A non-letter character already encodes Shift ("@", "?"): ignore Shift unless bound.
  if (b.shift !== e.shiftKey && !(!b.shift && b.key.length === 1 && !isLetter(b.key))) return false;
  let ctrl = b.ctrl;
  let meta = b.meta;
  if (b.mod) {
    if (mod === "meta") meta = true;
    else ctrl = true;
  }
  return ctrl === e.ctrlKey && meta === e.metaKey;
}

/**
 * The host binding for a key event, or `undefined` when none applies (then the backend's
 * defaults run). A binding naming explicit modifiers wins over a `Mod` one.
 */
type Keymap = Readonly<Record<string, KeyBinding>>;

/** Parsed bindings per keymap object — parsed once, not on every keydown. */
const parsedKeymaps = new WeakMap<Keymap, ReadonlyArray<{ name: string; parsed: ParsedBinding }>>();

/**
 * Parse (and cache) every binding of `keymap`, throwing on a malformed name.
 * `createEditorStateFromState` calls this, so a bad binding fails at configuration time.
 */
export function compileKeymap(keymap: Keymap): ReadonlyArray<{ name: string; parsed: ParsedBinding }> {
  let compiled = parsedKeymaps.get(keymap);
  if (compiled === undefined) {
    compiled = Object.keys(keymap).map((name) => ({ name, parsed: parseKeyBinding(name) }));
    parsedKeymaps.set(keymap, compiled);
  }
  return compiled;
}

export function matchKeyBinding(
  keymap: Keymap | undefined,
  event: KeyEventLike,
  mod: ModConvention,
): { readonly name: string; readonly binding: KeyBinding } | undefined {
  if (keymap === undefined) return undefined;
  let modMatch: { name: string; binding: KeyBinding } | undefined;
  for (const { name, parsed } of compileKeymap(keymap)) {
    if (!matches(parsed, event, mod)) continue;
    const binding = keymap[name] ?? null;
    if (!parsed.mod) return { name, binding };
    modMatch ??= { name, binding };
  }
  return modMatch;
}

/** The command a binding / name refers to (`null` when unbound or unknown). */
export function resolveCommand(target: KeyBinding, extensions: EditorExtensions | undefined): Command | null {
  if (target === null) return null;
  if (typeof target === "string") return extensions?.commands?.[target] ?? null;
  return target;
}

/**
 * What a backend does with a key event before its defaults: `"handled"` (a host command
 * ran — preventDefault, stop), `"blocked"` (the key is unbound — preventDefault, skip the
 * defaults), or `"default"` (no host binding applies).
 */
export function runKeyBinding(
  extensions: EditorExtensions | undefined,
  event: KeyEventLike,
  mod: ModConvention,
  editor: EditorState,
  dispatch: (action: EditorAction) => void,
): "handled" | "blocked" | "default" {
  const hit = matchKeyBinding(extensions?.keymap, event, mod);
  if (hit === undefined) return "default";
  if (hit.binding === null) return "blocked";
  const command = resolveCommand(hit.binding, extensions);
  if (command === null) return "default";
  return command(editor, dispatch) ? "handled" : "default";
}

/**
 * Whether `ESCAPE` would change anything: an object selection to collapse or an active
 * trigger to end. Backends claim the Escape key (preventDefault) only then, so an Escape
 * with nothing to dismiss still reaches the page (e.g. closes a containing dialog).
 */
export function escapeWouldChange(editor: EditorState, componentRegistry: ComponentRegistry): boolean {
  return editor.activeTrigger !== undefined || isObjectSelection(editor.state, editor.selection, componentRegistry) !== null;
}
