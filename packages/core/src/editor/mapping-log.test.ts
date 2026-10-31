import { describe, it, expect } from "vitest";
import { config, reduceEditor, createInitialEditorState, createPosition, createSpan } from "./actions/test-helpers";
import type { EditorAction } from "./editor-action";
import type { EditorState } from "./editor-state";
import { createMappingLog } from "./mapping-log";
import { transitionMapping } from "../decorations/decoration-layers";

describe("createMappingLog", () => {
  it("composes every transition since an older Document; unknown / restarted Documents map to null", () => {
    let e = createInitialEditorState(config);
    e = reduceEditor(e, { type: "INSERT_TEXT", text: "Anna met Rosa" });
    const p = e.selection.focus.blockId;
    const log = createMappingLog(3);
    log.reset(e.document);
    const old = e.document;
    const apply = (action: EditorAction): void => {
      const prev: EditorState = e;
      e = reduceEditor(e, action);
      if (prev.document !== e.document) log.record(prev.document, e.document, transitionMapping(prev, e));
    };
    apply({ type: "SET_SELECTION", selection: createSpan(createPosition(p, 0), createPosition(p, 0)) });
    apply({ type: "INSERT_TEXT", text: "So " });
    apply({ type: "INSERT_TEXT", text: "then " });
    const m = log.mappingFrom(old);
    expect(m?.map(createPosition(p, 9)).position).toEqual(createPosition(p, 17)); // "Rosa"
    expect(log.mappingFrom(e.document)?.identity).toBe(true);
    // Capacity 3: after two more edits the original Document has aged out.
    apply({ type: "INSERT_TEXT", text: "a" });
    apply({ type: "INSERT_TEXT", text: "b" });
    expect(log.mappingFrom(old)).toBeNull();
    log.reset(e.document);
    expect(log.mappingFrom(old)).toBeNull();
  });
});
