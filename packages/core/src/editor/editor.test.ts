import { describe, it, expect, vi } from "vitest";
import { stateWithText, firstChildId, getTextOf, createPosition } from "./actions/test-helpers";
import { dispatchProposal, newSuggestionGroupId, type ProposeResult } from "./proposals";
import { createDefaultAttrRegistry } from "../cascade/attr-registry";

describe("Editor.dispatch", () => {
  it("a dispatch from a subscriber runs after every subscriber heard the current change", () => {
    const editor = stateWithText("a");
    const heard: string[] = [];
    editor.subscribe(({ action }) => {
      if (action.type === "INSERT_TEXT" && action.text === "b") editor.dispatch({ type: "INSERT_TEXT", text: "c" });
    });
    editor.subscribe(({ action }) => heard.push(action.type === "INSERT_TEXT" ? action.text : action.type));
    editor.dispatch({ type: "INSERT_TEXT", text: "b" });
    expect(heard).toEqual(["b", "c"]);
  });

  it("a throwing subscriber stops nothing: the others hear the change, queued actions run, the error is reported asynchronously", () => {
    const editor = stateWithText("a");
    const id = firstChildId(editor.document);
    if (id === null) throw new Error("no paragraph");
    const reported: Array<() => void> = [];
    vi.stubGlobal("queueMicrotask", (task: () => void) => reported.push(task));
    try {
      let first = true;
      editor.subscribe(() => {
        if (!first) return;
        first = false;
        editor.dispatch({ type: "INSERT_TEXT", text: "c" });
        throw new Error("subscriber failed");
      });
      const heard: string[] = [];
      editor.subscribe(({ action }) => heard.push(action.type === "INSERT_TEXT" ? action.text : action.type));
      expect(() => editor.dispatch({ type: "INSERT_TEXT", text: "b" })).not.toThrow();
      expect(heard).toEqual(["b", "c"]);
      expect(getTextOf(editor.document, id)).toBe("abc");
    } finally {
      vi.unstubAllGlobals();
    }
    expect(reported).toHaveLength(1);
    expect(() => reported[0]?.()).toThrow("subscriber failed");
  });

  it("a queued action that throws is rolled back and reported; the next queued action runs; the outermost one's error reaches its caller", async () => {
    const editor = stateWithText("a");
    const id = firstChildId(editor.document);
    if (id === null) throw new Error("no paragraph");
    const boom = (): never => {
      throw new Error("action failed");
    };
    const reported: Array<() => void> = [];
    vi.stubGlobal("queueMicrotask", (task: () => void) => reported.push(task));
    try {
      const off = editor.subscribe(() => {
        off();
        editor.dispatch({ type: "TRANSACTION", run: (tx) => (tx.dispatch({ type: "INSERT_TEXT", text: "X" }), boom()) });
        editor.dispatch({ type: "INSERT_TEXT", text: "c" });
      });
      editor.dispatch({ type: "INSERT_TEXT", text: "b" });
      expect(getTextOf(editor.document, id)).toBe("abc");
      // The outermost action's error escapes only after the queue drains: what it
      // dispatched before failing still runs.
      let proposed: Promise<ProposeResult> | undefined;
      expect(() =>
        editor.dispatch({
          type: "TRANSACTION",
          run: () => {
            editor.dispatch({ type: "INSERT_TEXT", text: "c" });
            proposed = dispatchProposal(editor, { groupId: newSuggestionGroupId(), author: "a", edits: [{ kind: "format", from: createPosition(id, 0), to: createPosition(id, 1), attrs: { bold: true } }] });
            boom();
          },
        }),
      ).toThrow("action failed");
      expect(getTextOf(editor.document, id)).toBe("abcc");
      expect(await proposed).toEqual({ ok: true });
    } finally {
      vi.unstubAllGlobals();
    }
    expect(reported).toHaveLength(1);
    expect(() => reported[0]?.()).toThrow("action failed");
  });
});

describe("Editor.setConfig", () => {
  it("refuses a config with other registries", () => {
    const editor = stateWithText("a");
    const config = editor.config;
    expect(() => editor.setConfig({ ...config, attrRegistry: createDefaultAttrRegistry() })).toThrow(/registries are fixed/);
    expect(editor.config).toBe(config);
  });
});
