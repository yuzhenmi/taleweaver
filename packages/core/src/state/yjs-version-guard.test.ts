/**
 * Yjs internal API guard.
 *
 * Two internal Yjs fields are load-bearing in this codebase:
 *
 * 1. `Y.Map._item.parentSub` — used by `findOwningBlockId` in `yjs-doc.ts` for
 *    O(1) reverse lookup of the key under which a nested Y.Map was inserted
 *    into its parent (instead of linear-scanning the outer map).
 * 2. `Y.Doc._transaction` — used by `isInYjsTransaction` / `requireInTransaction`
 *    in `yjs-doc.ts` to detect whether code is currently inside a
 *    `Y.Doc.transact(fn)` callback. Set to the active `Y.Transaction` while
 *    inside, `null` outside. `requireInTransaction` guards every `*InTx` helper
 *    against silent dirty-id loss from a missing `runTransaction` wrap.
 *
 * Both fields are documented as internal in Yjs but are stable across the 13.x
 * line and used by Yjs's own bindings (e.g. `y-prosemirror`).
 *
 * We pin Yjs to `~13.6.x` (patch upgrades only) in `package.json` so a 13.7+
 * minor bump can't auto-take. These smoke tests are the second line of defense:
 * if Yjs ever removes or renames either field, the corresponding test fails
 * loudly in CI rather than letting the production code silently regress (a
 * removed `_transaction` would make `isInYjsTransaction` always return false,
 * causing every `*InTx` call to throw — the opposite of silent).
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

  it("Y.Doc._transaction is set to a non-null value inside doc.transact callback", () => {
    const doc = new Y.Doc();
    let txInside: unknown = undefined;
    doc.transact(() => {
      txInside = (doc as unknown as { _transaction: unknown })._transaction;
    });
    // Inside the transact callback, _transaction is the active Y.Transaction.
    expect(txInside).not.toBeNull();
    expect(txInside).not.toBeUndefined();
  });

  it("Y.Doc._transaction is null/undefined outside doc.transact", () => {
    const doc = new Y.Doc();
    const tx = (doc as unknown as { _transaction: unknown })._transaction;
    // Outside transact, _transaction is null (Yjs initializes it to null in
    // Doc's constructor; never undefined). isInYjsTransaction uses `!= null`
    // so either null or undefined would correctly evaluate to "not in tx".
    expect(tx == null).toBe(true);
  });
});
