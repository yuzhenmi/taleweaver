/**
 * Yjs internal API guard.
 *
 * `findOwningBlockId` in `yjs-doc.ts` relies on `Y.Map._item.parentSub` — the
 * key under which a nested Y.Map was inserted into its parent — to perform an
 * O(1) reverse lookup instead of linear-scanning the outer map. This property
 * is documented as internal in Yjs but is stable across the 13.x line and used
 * by Yjs's own bindings (e.g. `y-prosemirror`).
 *
 * We pin Yjs to `~13.6.x` (patch upgrades only) in `package.json` so a 13.7+
 * minor bump can't auto-take. This smoke test is the second line of defense:
 * if Yjs ever removes or renames the field, this test fails loudly in CI and
 * we fall back to the redundant-`id`-field approach.
 */
import * as Y from "yjs";
import { describe, it, expect } from "vitest";

describe("Yjs internal API guard", () => {
  it("Y.Map exposes _item.parentSub after insertion into a parent map", () => {
    const doc = new Y.Doc();
    const outer = doc.getMap("outer");
    const inner = new Y.Map();
    outer.set("childKey", inner);
    const item = (inner as unknown as { _item?: { parentSub?: string } })._item;
    expect(item).toBeDefined();
    expect(item?.parentSub).toBe("childKey");
  });

  it("Y.Map exposes _item.parentSub for deeply nested maps too", () => {
    const doc = new Y.Doc();
    const outer = doc.getMap("outer");
    const mid = new Y.Map();
    const inner = new Y.Map();
    outer.set("midKey", mid);
    mid.set("innerKey", inner);
    const midItem = (mid as unknown as { _item?: { parentSub?: string } })._item;
    const innerItem = (inner as unknown as { _item?: { parentSub?: string } })
      ._item;
    expect(midItem?.parentSub).toBe("midKey");
    expect(innerItem?.parentSub).toBe("innerKey");
  });
});
