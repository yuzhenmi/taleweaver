import { describe, it, expect } from "vitest";
import { inheritedAttrsAt } from "./typing-attrs";
import { buildFlowDoc, text, buildBlock, buildState, inlineContent, withTestAttrs } from "../test-utils/state-builders";
import { createPosition, type BlockId } from "../state";

describe("inheritedAttrsAt — an EMPTY paragraph types with its ¶'s character props (Word / GDocs)", () => {
  it("an emptied paragraph's caret takes the ¶'s markAttrs", () => {
    const s = withTestAttrs(buildFlowDoc([{ p: "E", t: "", markAttrs: { bold: true, fontSize: 18 } }]));
    expect(inheritedAttrsAt(s, createPosition("E" as BlockId, 0))).toEqual({ bold: true, fontSize: 18 });
  });

  it("a non-empty paragraph still inherits from its text (the ¶ is not consulted)", () => {
    const s = withTestAttrs(buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "P", lastChildId: "P" }),
        { ...buildBlock({ id: "P", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("ab", { italic: true })]) }), markAttrs: { bold: true } },
      ],
    }));
    expect(inheritedAttrsAt(s, createPosition("P" as BlockId, 0))).toEqual({ italic: true });
    expect(inheritedAttrsAt(s, createPosition("P" as BlockId, 2))).toEqual({ italic: true });
  });
});
