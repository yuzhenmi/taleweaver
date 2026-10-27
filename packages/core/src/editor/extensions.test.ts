import { describe, it, expect } from "vitest";
import {
  createInitialEditorState,
  reduceEditor,
  createDefaultComponentRegistry,
  createDefaultAttrRegistry,
  registerMark,
  getMarkRanges,
  getBlock,
  createPosition,
  createSpan,
  matchKeyBinding,
  compileKeymap,
  runKeyBinding,
  triggerChange,
  replaceRangeWithMarkedText,
  INSERTION_SUGGESTION_ATTR,
  getSuggestions,
  type EditorAction,
  type EditorConfig,
  type EditorExtensions,
  type EditorState,
  type BlockId,
  type KeyEventLike,
  type Command,
} from "../index";

const extensions: EditorExtensions = {
  inputRules: [
    { pattern: /--$/, replace: "—" },
    { pattern: /\(c\)$/, replace: (_m, range) => [{ type: "SET_SELECTION", selection: createSpan(range.from, range.to) }, { type: "INSERT_TEXT", text: "©" }] },
  ],
  triggers: [
    { id: "mention", text: "@" },
    { id: "link", text: "[[", allowSpaces: true },
  ],
};

function makeConfig(extra?: Partial<EditorConfig>): EditorConfig {
  const attrRegistry = createDefaultAttrRegistry();
  registerMark(attrRegistry, "mention", { atomic: true });
  return { componentRegistry: createDefaultComponentRegistry(), attrRegistry, containerWidth: 800, extensions, ...extra };
}

function run(editor: EditorState, config: EditorConfig, ...actions: EditorAction[]): EditorState {
  let s = editor;
  for (const a of actions) s = reduceEditor(s, a, config);
  return s;
}

/** Type `text` one user keystroke at a time. */
function type(editor: EditorState, config: EditorConfig, text: string): EditorState {
  let s = editor;
  for (const ch of text) s = reduceEditor(s, { type: "INSERT_TEXT", text: ch, userInput: true }, config);
  return s;
}

const textOf = (s: EditorState, id: BlockId = s.selection.focus.blockId): string =>
  (getBlock(s.state, id)?.inlineContent?.items ?? []).map((i) => (i.kind === "text" ? i.text : "￼")).join("");

const caret = (id: BlockId, o: number): EditorAction => ({ type: "SET_SELECTION", selection: createSpan(createPosition(id, o), createPosition(id, o)) });

describe("TRANSACTION", () => {
  it("several steps are ONE undo entry; redo reapplies all; dirty ids are the union", () => {
    const config = makeConfig();
    let s = run(createInitialEditorState(config), config, { type: "INSERT_TEXT", text: "ab" }, { type: "SPLIT_NODE" }, { type: "INSERT_TEXT", text: "cd" });
    const second = s.selection.focus.blockId;
    const first = getBlock(s.state, second)?.prevSiblingId ?? null;
    if (first === null) throw new Error("setup");
    s = run(s, config, {
      type: "TRANSACTION",
      run: (tx) => {
        tx.dispatch(caret(first, 2));
        tx.dispatch({ type: "INSERT_TEXT", text: "X" });
        tx.dispatch(caret(second, 0));
        tx.dispatch({ type: "INSERT_TEXT", text: "Y" });
        tx.dispatch({ type: "SET_SELECTION", selection: createSpan(createPosition(second, 0), createPosition(second, 3)) });
        tx.dispatch({ type: "TOGGLE_STYLE", style: "bold" });
      },
    });
    expect([textOf(s, first), textOf(s, second)]).toEqual(["abX", "Ycd"]);
    expect(new Set(s.lastDirtyIds)).toEqual(new Set([first, second]));
    const undone = run(s, config, { type: "UNDO" });
    expect([textOf(undone, first), textOf(undone, second)]).toEqual(["ab", "cd"]);
    expect(undone.selection.focus).toEqual(createPosition(second, 2)); // the selection before the transaction
    const redone = run(undone, config, { type: "REDO" });
    expect([textOf(redone, first), textOf(redone, second)]).toEqual(["abX", "Ycd"]);
    // The edit after a transaction is its own entry.
    const after = run(redone, config, caret(second, 3), { type: "INSERT_TEXT", text: "Z" }, { type: "UNDO" });
    expect(textOf(after, second)).toBe("Ycd");
  });

  it("in suggesting mode each step is tracked like the user edit", () => {
    const config = makeConfig({ suggestingAuthor: "A" });
    const s = run(createInitialEditorState(config), config, {
      type: "TRANSACTION",
      run: (tx) => {
        tx.dispatch({ type: "INSERT_TEXT", text: "hi" });
        tx.dispatch({ type: "INSERT_TEXT", text: "!" });
      },
    });
    const items = getBlock(s.state, s.selection.focus.blockId)?.inlineContent?.items ?? [];
    expect(items.every((i) => i.attrs[INSERTION_SUGGESTION_ATTR] !== undefined)).toBe(true);
    expect(textOf(run(s, config, { type: "UNDO" }))).toBe("");
  });
});

describe("input rules", () => {
  it("user-typed '--' becomes an em dash; one Undo restores the typed text", () => {
    const config = makeConfig();
    let s = type(createInitialEditorState(config), config, "a--");
    expect(textOf(s)).toBe("a—");
    expect(s.selection.focus.offset).toBe(2);
    s = run(s, config, { type: "UNDO" });
    expect(textOf(s)).toBe("a--");
    expect(textOf(run(s, config, { type: "UNDO" }))).toBe("");
  });

  it("a function rule runs its actions; programmatic inserts never fire rules", () => {
    const config = makeConfig();
    expect(textOf(type(createInitialEditorState(config), config, "x(c)"))).toBe("x©");
    expect(textOf(run(createInitialEditorState(config), config, { type: "INSERT_TEXT", text: "a--" }))).toBe("a--");
  });

  it("an autoformat keeps the matched text's formatting", () => {
    const config = makeConfig();
    const s = type(run(createInitialEditorState(config), config, { type: "TOGGLE_STYLE", style: "bold" }), config, "a--");
    const items = getBlock(s.state, s.selection.focus.blockId)?.inlineContent?.items ?? [];
    expect(items.map((i) => (i.kind === "text" ? [i.text, i.attrs] : null))).toEqual([["a—", { bold: true }]]);
  });
});

describe("triggers", () => {
  it("typing @ starts a trigger; the query follows typing; space / Escape / caret-away end it", () => {
    const config = makeConfig();
    let s = type(createInitialEditorState(config), config, "hi @");
    const id = s.selection.focus.blockId;
    expect(s.activeTrigger).toEqual({ id: "mention", from: createPosition(id, 3), to: createPosition(id, 4), query: "" });
    const started = s;
    s = type(s, config, "an");
    expect(s.activeTrigger?.query).toBe("an");
    expect(triggerChange(started, s)).toEqual({ type: "update", trigger: s.activeTrigger });
    expect(triggerChange(createInitialEditorState(config), started)?.type).toBe("start");
    expect(type(s, config, " ").activeTrigger).toBeUndefined();
    const esc = run(s, config, { type: "ESCAPE" });
    expect(esc.activeTrigger).toBeUndefined();
    expect(triggerChange(s, esc)?.type).toBe("exit");
    expect(type(esc, config, "n").activeTrigger).toBeUndefined(); // dismissed: not restarted by more typing
    expect(run(s, config, caret(id, 1)).activeTrigger).toBeUndefined();
    expect(run(s, config, { type: "DELETE_BACKWARD" }, { type: "DELETE_BACKWARD" }).activeTrigger?.query).toBe("");
    expect(run(s, config, { type: "DELETE_BACKWARD" }, { type: "DELETE_BACKWARD" }, { type: "DELETE_BACKWARD" }).activeTrigger).toBeUndefined();
  });

  it("only at a word start; multi-char triggers; programmatic text never starts one", () => {
    const config = makeConfig();
    expect(type(createInitialEditorState(config), config, "a@").activeTrigger).toBeUndefined();
    const link = type(createInitialEditorState(config), config, "see [[my page");
    expect(link.activeTrigger).toMatchObject({ id: "link", query: "my page" });
    expect(run(createInitialEditorState(config), config, { type: "INSERT_TEXT", text: "@" }).activeTrigger).toBeUndefined();
  });

  it("the trigger start is mapped through edits elsewhere in the block", () => {
    const config = makeConfig();
    let s = type(createInitialEditorState(config), config, "x @b");
    const id = s.selection.focus.blockId;
    s = run(s, config, {
      type: "TRANSACTION",
      run: (tx) => {
        tx.dispatch(caret(id, 0));
        tx.dispatch({ type: "INSERT_TEXT", text: "12" });
        tx.dispatch(caret(id, 6));
      },
    });
    expect(s.activeTrigger).toMatchObject({ from: createPosition(id, 4), query: "b" });
  });

  it("replaceRangeWithMarkedText swaps trigger + query for a mention in one undo step", () => {
    const config = makeConfig();
    let s = type(createInitialEditorState(config), config, "hi @an");
    const t = s.activeTrigger;
    if (t === undefined) throw new Error("no trigger");
    s = run(s, config, replaceRangeWithMarkedText(t, "Anna", { key: "mention", value: { ref: "p1" } }, " "));
    expect(textOf(s)).toBe("hi Anna ");
    expect(getMarkRanges(s.state, "mention").map((r) => [r.from.offset, r.to.offset])).toEqual([[3, 7]]);
    expect(s.activeTrigger).toBeUndefined();
    s = run(s, config, { type: "UNDO" });
    expect(textOf(s)).toBe("hi @an");
  });
});

describe("keymap", () => {
  const ev = (key: string, mods: Partial<KeyEventLike> = {}): KeyEventLike => ({
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...mods,
  });
  const keymap = { "Mod-Shift-m": "mention", "Ctrl-b": null, "Mod-b": "bold", "@": "at", "Alt-a": "alt" };

  it("Mod follows the backend convention; explicit modifiers win; letters ignore case", () => {
    expect(matchKeyBinding(keymap, ev("M", { metaKey: true, shiftKey: true }), "meta")?.name).toBe("Mod-Shift-m");
    expect(matchKeyBinding(keymap, ev("M", { ctrlKey: true, shiftKey: true }), "meta")).toBeUndefined();
    expect(matchKeyBinding(keymap, ev("m", { ctrlKey: true, shiftKey: true }), "ctrl")?.name).toBe("Mod-Shift-m");
    expect(matchKeyBinding(keymap, ev("m", { ctrlKey: true }), "ctrl")).toBeUndefined(); // Shift required
    expect(matchKeyBinding(keymap, ev("b", { ctrlKey: true }), "ctrl")?.name).toBe("Ctrl-b");
    expect(matchKeyBinding(keymap, ev("b", { metaKey: true }), "meta")?.name).toBe("Mod-b");
  });

  it("a character key ignores the Shift that produced it; Alt falls back to the physical key", () => {
    expect(matchKeyBinding(keymap, ev("@", { shiftKey: true }), "ctrl")?.name).toBe("@");
    expect(matchKeyBinding(keymap, ev("å", { altKey: true, code: "KeyA" }), "meta")?.name).toBe("Alt-a");
  });

  it("runKeyBinding: a command that runs → handled; null → blocked; false / none → default", () => {
    const config = makeConfig();
    const editor = createInitialEditorState(config);
    const dispatched: EditorAction[] = [];
    const yes: Command = (_e, dispatch) => {
      dispatch?.({ type: "INSERT_TEXT", text: "!" });
      return true;
    };
    const no: Command = () => false;
    const ext: EditorExtensions = { commands: { yes, no }, keymap: { "Mod-y": "yes", "Mod-n": "no", "Mod-u": null } };
    const go = (key: string) => runKeyBinding(ext, ev(key, { ctrlKey: true }), "ctrl", editor, (a) => dispatched.push(a));
    expect(go("y")).toBe("handled");
    expect(dispatched).toEqual([{ type: "INSERT_TEXT", text: "!" }]);
    expect(go("u")).toBe("blocked");
    expect(go("n")).toBe("default");
    expect(go("q")).toBe("default");
  });
});

describe("TRANSACTION rollback", () => {
  it("a throwing transaction rolls back every applied step and leaves history intact", () => {
    const config = makeConfig();
    let s = run(createInitialEditorState(config), config, { type: "INSERT_TEXT", text: "abc" });
    const before = s;
    expect(() =>
      run(s, config, {
        type: "TRANSACTION",
        run: (tx) => {
          tx.dispatch({ type: "INSERT_TEXT", text: "X" });
          tx.dispatch({ type: "SPLIT_NODE" });
          throw new Error("boom");
        },
      }),
    ).toThrow("boom");
    s = before; // the caller keeps its pre-transaction state
    expect(textOf(s)).toBe("abc");
    s = run(s, config, { type: "INSERT_TEXT", text: "!" });
    expect(textOf(s)).toBe("abc!");
    const root = getBlock(s.state, s.state.rootId);
    expect(getBlock(s.state, root?.firstChildId ?? ("" as BlockId))?.nextSiblingId ?? null).toBeNull();
    s = run(s, config, { type: "UNDO" });
    expect(textOf(s)).toBe("abc");
    s = run(s, config, { type: "REDO" });
    expect(textOf(s)).toBe("abc!");
  });
});

describe("review round 1", () => {
  it("a picked mention whose label spells the trigger never re-activates it (allowSpaces + suffix)", () => {
    const config = makeConfig({ extensions: { triggers: [{ id: "mention", text: "@", allowSpaces: true }] } });
    let s = type(createInitialEditorState(config), config, "hi @an");
    const t = s.activeTrigger;
    if (t === undefined) throw new Error("no trigger");
    s = run(s, config, replaceRangeWithMarkedText(t, "@Anna Lee", { key: "mention", value: { ref: "p1" } }, " "));
    expect(textOf(s)).toBe("hi @Anna Lee ");
    expect(s.activeTrigger).toBeUndefined();
    // Typing on: still no trigger over the mention (atomic text never re-validates).
    s = type(s, config, "x");
    expect(s.activeTrigger).toBeUndefined();
  });

  it("a trigger never re-validates over text carrying an atomic mark (even without the explicit end)", () => {
    const config = makeConfig({ extensions: { triggers: [{ id: "mention", text: "@", allowSpaces: true }] } });
    let s = type(createInitialEditorState(config), config, "@an");
    const id = s.selection.focus.blockId;
    s = run(s, config, {
      type: "TRANSACTION",
      run: (tx) => {
        tx.dispatch({ type: "SET_SELECTION", selection: createSpan(createPosition(id, 0), createPosition(id, 3)) });
        tx.dispatch({ type: "INSERT_TEXT", text: "@Anna" });
        tx.dispatch({ type: "SET_MARK", key: "mention", value: { ref: "p1" }, span: createSpan(createPosition(id, 0), createPosition(id, 5)) });
        tx.dispatch(caret(id, 5));
      },
    });
    expect(textOf(s)).toBe("@Anna");
    expect(s.activeTrigger).toBeUndefined();
  });

  it("startOfWord accepts opening punctuation before the trigger", () => {
    const config = makeConfig();
    expect(type(createInitialEditorState(config), config, "(@a").activeTrigger?.query).toBe("a");
    expect(type(createInitialEditorState(config), config, "“@a").activeTrigger?.query).toBe("a");
    expect(type(createInitialEditorState(config), config, "x@a").activeTrigger).toBeUndefined();
  });

  it("non-Latin layouts match the physical key; a malformed keymap fails when compiled", () => {
    const e = { key: "и", code: "KeyB", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false };
    expect(matchKeyBinding({ "Mod-b": null }, e, "ctrl")?.name).toBe("Mod-b");
    expect(matchKeyBinding({ "Mod-1": null }, { ...e, key: "&", code: "Digit1" }, "ctrl")).toBeUndefined(); // ASCII key wins
    expect(() => compileKeymap({ "Hyper-x": null })).toThrow(/unknown modifier/);
    const km = { "Mod-b": null };
    expect(compileKeymap(km)).toBe(compileKeymap(km)); // parsed once per keymap object
  });
});

describe("TRANSACTION steps must be undoable", () => {
  it("dispatching UNDO / REDO / PROPOSE (not undoable here) throws before applying and rolls back earlier steps", () => {
    const suggest = makeConfig({ suggestingAuthor: "A" });
    const config = makeConfig();
    let s = run(createInitialEditorState(suggest), suggest, { type: "INSERT_TEXT", text: "abc" });
    const proposal = { type: "PROPOSE", proposal: { groupId: "g", author: "B", edits: [] } } as const;
    for (const bad of [{ type: "UNDO" }, { type: "REDO" }, proposal] as const) {
      expect(() =>
        run(s, config, {
          type: "TRANSACTION",
          run: (tx) => {
            tx.dispatch({ type: "INSERT_TEXT", text: "X" });
            tx.dispatch(bad);
          },
        }),
      ).toThrow(/not undoable/);
      expect(textOf(s)).toBe("abc");
    }
    s = run(s, config, { type: "INSERT_TEXT", text: "!" });
    expect(textOf(s)).toBe("abc!");
    s = run(s, config, { type: "UNDO" });
    expect(textOf(s)).toBe("abc");
    s = run(s, config, { type: "UNDO" });
    expect(textOf(s)).toBe("");
  });

  it("suggestion accept / reject are ordinary undoable steps inside a transaction (one undo step for all)", () => {
    const suggest = makeConfig({ suggestingAuthor: "A" });
    const config = makeConfig();
    let s = run(createInitialEditorState(suggest), suggest, { type: "INSERT_TEXT", text: "abc" });
    const [suggestion] = getSuggestions(s.state);
    if (suggestion === undefined) throw new Error("setup");
    s = run(s, config, {
      type: "TRANSACTION",
      run: (tx) => {
        tx.dispatch({ type: "ACCEPT_SUGGESTION", id: suggestion.id });
        tx.dispatch({ type: "INSERT_TEXT", text: "!" });
      },
    });
    expect(getSuggestions(s.state)).toHaveLength(0);
    expect(textOf(s)).toBe("abc!");
    s = run(s, config, { type: "UNDO" });
    expect(textOf(s)).toBe("abc");
    expect(getSuggestions(s.state)).toHaveLength(1);
  });

});

describe("round 2", () => {
  it("a swallowed nested-transaction failure rolls back the whole outer transaction and throws", () => {
    const config = makeConfig();
    let s = run(createInitialEditorState(config), config, { type: "INSERT_TEXT", text: "abc" });
    const before = s;
    expect(() =>
      run(s, config, {
        type: "TRANSACTION",
        run: (tx) => {
          try {
            tx.dispatch({
              type: "TRANSACTION",
              run: (inner) => {
                inner.dispatch({ type: "INSERT_TEXT", text: "X" });
                throw new Error("inner");
              },
            });
          } catch {
            // swallowed by the outer run
          }
          tx.dispatch({ type: "INSERT_TEXT", text: "Y" });
        },
      }),
    ).toThrow(/nested transaction failed/);
    s = before;
    expect(textOf(s)).toBe("abc");
    s = run(s, config, { type: "INSERT_TEXT", text: "!" });
    expect(textOf(s)).toBe("abc!");
    expect(s.selection.focus.offset).toBe(4);
    expect(textOf(run(s, config, { type: "UNDO" }))).toBe("abc");
  });

  it("AltGr text (Ctrl+Alt producing a character) never matches through the physical key", () => {
    const km = { "Mod-Alt-l": null };
    const altGr = { key: "ł", code: "KeyL", ctrlKey: true, metaKey: false, altKey: true, shiftKey: false };
    expect(matchKeyBinding(km, altGr, "ctrl")).toBeUndefined();
    expect(matchKeyBinding(km, { ...altGr, getModifierState: (k: string) => k === "AltGraph" }, "ctrl")).toBeUndefined();
    expect(matchKeyBinding(km, { ...altGr, key: "l" }, "ctrl")?.name).toBe("Mod-Alt-l"); // a real Ctrl+Alt+L
  });

  it("AltGraph is trusted when reported: real Ctrl+Alt chords on any layout / on a Mac still match", () => {
    // Left Ctrl + Alt on a Cyrillic layout: the browser reports AltGraph = false.
    const cyr = { key: "и", code: "KeyB", ctrlKey: true, metaKey: false, altKey: true, shiftKey: false, getModifierState: () => false };
    expect(matchKeyBinding({ "Ctrl-Alt-b": null }, cyr, "ctrl")?.name).toBe("Ctrl-Alt-b");
    expect(matchKeyBinding({ "Mod-Alt-b": null }, cyr, "ctrl")?.name).toBe("Mod-Alt-b");
    // Mac Ctrl+Option+B: no AltGr on Apple platforms, even without getModifierState.
    const mac = { key: "∫", code: "KeyB", ctrlKey: true, metaKey: false, altKey: true, shiftKey: false };
    expect(matchKeyBinding({ "Ctrl-Alt-b": null }, mac, "meta")?.name).toBe("Ctrl-Alt-b");
    // Firefox on macOS reports Option as AltGraph: Option+A ("å") still matches Alt-a.
    const ffMac = { key: "å", code: "KeyA", ctrlKey: false, metaKey: false, altKey: true, shiftKey: false, getModifierState: (k: string) => k === "AltGraph" };
    expect(matchKeyBinding({ "Alt-a": null }, ffMac, "meta")?.name).toBe("Alt-a");
    // Polish AltGr+L reported as AltGraph: still never intercepted.
    const polish = { key: "ł", code: "KeyL", ctrlKey: true, metaKey: false, altKey: true, shiftKey: false, getModifierState: (k: string) => k === "AltGraph" };
    expect(matchKeyBinding({ "Mod-Alt-l": null, "Ctrl-Alt-l": null }, polish, "ctrl")).toBeUndefined();
  });
});
