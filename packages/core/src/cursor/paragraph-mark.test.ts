import { describe, it, expect } from "vitest";
import { selectParagraph } from "./paragraph-mark";
import { moveByCharacter } from "./cursor-ops";
import { buildFlowDoc } from "../test-utils/document-builders";
import { createPosition, createSpan } from "../state";
import type { BlockId } from "../state";

const at = (id: string, k: number) => createPosition(id as BlockId, k);

/** the ¶ is a unit between (P, len) and (N, 0). */
describe("the ¶ as a text unit", () => {
  const document = buildFlowDoc([{ p: "a", t: "one" }, { p: "b", t: "two" }, { sec: "S", children: [{ p: "c", t: "x" }] }, { p: "d", t: "end" }]);

  it("select-paragraph (triple-click) = (P, 0)–(N, 0): it includes ¶P", () => {
    expect(selectParagraph(document, at("a", 1))).toEqual(createSpan(at("a", 0), at("b", 0)));
  });

  it("…across a section break: N is the next section's first paragraph (¶P is the section end)", () => {
    expect(selectParagraph(document, at("b", 2))).toEqual(createSpan(at("b", 0), at("c", 0)));
  });

  it("…at a flow's last paragraph it is (P, 0)–(P, len): no Position after the final ¶", () => {
    expect(selectParagraph(document, at("d", 1))).toEqual(createSpan(at("d", 0), at("d", 3)));
  });

  it("(P, len) and (N, 0) are distinct carets: Arrow Right crosses the ¶, Arrow Left comes back", () => {
    expect(moveByCharacter(document, at("a", 3), "forward")).toEqual(at("b", 0));
    expect(moveByCharacter(document, at("b", 0), "backward")).toEqual(at("a", 3));
  });
});
