# P1.C.2a — `templateContents` Y.Map + `resolveBlock` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to
> implement this plan task-by-task (one implementer per task; spec + quality review; controller
> commits). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a third top-level subtree map, `templateContents` (parallel to `embedContents`),
wired through every dirty-tracking / undo / snapshot / render site, plus a unified
`resolveBlock(state, id) → { block, kind }` accessor. Inert: no block references
`templateContents` yet, so there is ZERO behavior change — it is the state-layer foundation for
C.2c headers/footers.

**Architecture:** `templateContents` mirrors `embedContents` exactly: a `Y.Map<BlockId, Y.Map>`
holding detached body subtrees, read via frozen snapshots through the layered `SnapshotCache`,
tracked by `captureDirtyIds`/`findOwningBlockId` + the `History` `Y.UndoManager`, rendered into a
parallel `RenderOutput.templateContents` map. Because block ids are globally unique across all
three maps, `resolveBlock` can report which tree owns an id. Spec:
`docs/superpowers/specs/2026-05-25-p1c-c2-section-pagination-design.md` (§ C.2a).

**Tech Stack:** TypeScript, Yjs (`Y.Doc`/`Y.Map`), vitest. All changes in `packages/core/src/state/`
+ `packages/core/src/render/render.ts`.

**Test-seeding note (read before T1).** There is NO Layer-3 op that writes `templateContents`
until C.2c. So tests seed a template body directly: inside a `doc.transact(...)`, call
`getTemplateContentsMap(doc).set(id, buildYBlock({...}))` (same `buildYBlock` used by
`y-block.ts`). For State-level tests, extend the `buildState` test helper
(`packages/core/src/test-utils/state-builders.ts`) with an optional `templateContents:
BlockSeed[]` param that seeds the template map alongside `blocks`/`embedContents` — OR seed
directly via `getTemplateContentsMap(state[STATE_INTERNAL].doc)`. Prefer extending `buildState`
(cleaner, reused across T1–T5); decide in T1 and reuse.

---

## File structure

- Modify `packages/core/src/state/yjs-doc.ts` (T1) — key, getter, init, `getYBlock`, dirty capture.
- Modify `packages/core/src/state/history.ts` (T2) — UndoManager tracked scopes.
- Modify `packages/core/src/state/snapshot.ts` (T3) — third cache dimension across all functions.
- Modify `packages/core/src/state/state.ts` (T4) — accessors + `resolveBlock`.
- Modify `packages/core/src/render/render.ts` (T5) — `RenderOutput.templateContents` + render loops.
- Modify `packages/core/src/test-utils/state-builders.ts` (T1) — `buildState` template seeding.
- Tests alongside each modified module.

---

## Task 1: `yjs-doc.ts` — templateContents map + dirty-tracking core

**Files:**
- Modify: `packages/core/src/state/yjs-doc.ts`
- Modify: `packages/core/src/state/id-collision-check.ts` (third-map `has` check — I1)
- Modify: `packages/core/src/test-utils/state-builders.ts` (add template seeding to `buildState`)
- Modify: `packages/core/src/state/build-state-from-blocks.ts` (the actual seeding impl `buildState`
  delegates to — I2)
- Test: `packages/core/src/state/yjs-doc.test.ts`
- Test (UPDATE, signature ripple — C1): `packages/core/src/state/perf-find-owning-block.test.ts`

Changes:
1. `const TEMPLATE_CONTENTS_KEY = "templateContents";`
2. `export function getTemplateContentsMap(doc): Y.Map<Y.Map<unknown>>` (mirror `getEmbedContentsMap`).
3. `createYDoc`: add `doc.getMap(TEMPLATE_CONTENTS_KEY);` alongside the other two `getMap` calls.
4. `getYBlock`: extend `kind` to `"block" | "embedContent" | "templateContent"` and the internal
   map selection to a 3-way switch (`block`→blocks, `embedContent`→embeds, `templateContent`→templates).
5. `captureDirtyIds`: add `const templateContentsMap = getTemplateContentsMap(doc);` +
   `const templateContentsMapAsAny = templateContentsMap as unknown as AnyYType;`; add a third
   `tx.changed.get(templateContentsMapAsAny)` block (mirror the embeds block); pass
   `templateContentsMapAsAny` into `findOwningBlockIdMemoized`.
6. `findOwningBlockId` + `findOwningBlockIdMemoized` + `findOwningBlockIdForTest`: add a
   `templateContentsMapAsAny: AnyYType` parameter and extend the parent check to
   `parent === blocksMapAsAny || parent === embedContentsMapAsAny || parent === templateContentsMapAsAny`.
   **Decide the param ORDER for `findOwningBlockIdForTest` deliberately** — `perf-find-owning-block.test.ts`
   extracts arg types positionally via `Parameters<typeof findOwningBlockIdForTest>[N]`. Append
   `templateContentsMapAsAny` as the 3rd param and keep `type` LAST (so its signature becomes
   `(blocksMapAsAny, embedContentsMapAsAny, templateContentsMapAsAny, type)`); the perf test must
   then pass `getTemplateContentsMap(doc) as unknown as Parameters<...>[2]` as the 3rd arg and shift
   `yTextAsAny` to the 4th — at ALL three call sites + the warmup loop + the correctness check.
7. **`id-collision-check.ts` (I1):** `assertNoIdCollision` checks `getBlocksMap(doc).has` +
   `getEmbedContentsMap(doc).has`; add `|| getTemplateContentsMap(doc).has(newId)` so the dev-mode
   collision guard covers the third map now that it exists. (Read-only guard; no writer in C.2a, but
   the map exists so the guard must be complete.)

- [ ] **Step 1: Write failing test.** In `buildState`, add an optional `templateContents` seed
  param (seed via `getTemplateContentsMap(doc).set(id, buildYBlock(init))` in the construction
  transaction). Then a test: build a state with one template body block `tmplP` (a paragraph),
  run `runTransaction(doc, () => getYBlock(doc, "tmplP", "test", "templateContent").set("attrs", buildYAttrs({...})))`
  (or edit its inline content), and assert the returned `dirtyIds` contains `"tmplP"`. A second
  test: a NESTED edit (mutate a Y type inside the template body's inlineContent) also yields
  `dirtyIds` ⊇ `{tmplP}` (exercises the `findOwningBlockId` template branch). ALSO update the
  existing structural test ("creates a Y.Doc with the three top-level maps") to assert
  `getTemplateContentsMap(doc) instanceof Y.Map` and rename it to "four top-level maps" (I3).
- [ ] **Step 2: Run, confirm fail** (`getTemplateContentsMap` undefined / dirtyIds empty).
  Run: `npm test --workspace=packages/core -- --run yjs-doc`
- [ ] **Step 3: Implement** items 1–7 above (incl. the `perf-find-owning-block.test.ts` 4-arg
  update from item 6 and the `id-collision-check.ts` third-`has` from item 7).
- [ ] **Step 4: Run tests + `npm run build --workspace=packages/core`.** Then run the FULL suite —
  the `findOwningBlockId*` signature change has exactly one external caller,
  `perf-find-owning-block.test.ts` (updated in Step 3 per item 6); `yjs-version-guard.test.ts`
  does NOT call it. Confirm the build is clean (the `Parameters<...>[N]` positional extraction in
  the perf test compiles with the new arg order).
- [ ] **Step 5: Commit** (controller, post-review).

## Task 2: `history.ts` — UndoManager tracks templateContents

**Files:** Modify `packages/core/src/state/history.ts`; Test: `packages/core/src/state/history.test.ts`.

- [ ] **Step 1: Write failing test.** Build a state with a seeded template body; via
  `runTransaction` edit the template body; `history.commit(opResult, selections)`; assert
  `history.canUndo`, then `history.undo()` restores the pre-edit template body (read back via
  `getTemplateContent` — available after T4; for T2 in isolation, read via
  `getTemplateContentsMap(doc).get(id)` raw, or sequence T2 after T4). NOTE: to keep T2
  self-contained, assert undo/redo at the Y.Doc level (the template body Y.Map's field reverts).
- [ ] **Step 2: Run, confirm fail** (undo doesn't revert the template edit — UndoManager doesn't
  track that map).
- [ ] **Step 3: Implement.** In the `History` constructor, add `getTemplateContentsMap(doc)` to
  the `Y.UndoManager` tracked-types array (next to `getBlocksMap`/`getEmbedContentsMap`). Update
  BOTH stale docstrings that enumerate the tracked scopes (I4): the `getMetaMap` docstring in
  `yjs-doc.ts` ("the blocks map and the embedContents map") AND the `History` class-level
  "Meta-map exclusion (intentional)" docstring in `history.ts` ("ONLY the blocks map and the
  embedContents map") — both must now name `templateContents` as a tracked scope.
- [ ] **Step 4: Run tests + build + full suite.**
- [ ] **Step 5: Commit** (controller, post-review).

## Task 3: `snapshot.ts` — third cache dimension

**Files:** Modify `packages/core/src/state/snapshot.ts`; Test: `packages/core/src/state/snapshot.test.ts`.

Mirror the `embedContents` dimension across EVERY function (the embed precedent is the exact
template):
- `SnapshotCache`: add `readonly templateContents: Map<BlockId, Block>;` and
  `readonly invalidatedTemplates: Set<BlockId>;`.
- `createSnapshotCache`: init both empty.
- `createOverlayCache`: `invalidatedTemplates: new Set(dirtyIds)` (same conservative seeding as
  the other two — a globally-unique id lives in at most one tree).
- `compactCache`: collect `templateContents` entries (skip if collected or in
  `invalidatedAboveTemplates`) + maintain `invalidatedAboveTemplates` (seed from `dirtyIds`, fold
  each layer's `invalidatedTemplates`). **Do NOT omit this — missing it silently drops template
  snapshots after the chain-depth compaction fires (review issue 4).**
- `invalidateSnapshot`: `cache.templateContents.delete(id); cache.invalidatedTemplates.add(id);`.
- **`invalidateAll` (C2 — do NOT omit):** `cache.templateContents.clear()` AND, in the base-chain
  walk, add each `layer.templateContents.keys()` to `cache.invalidatedTemplates` (mirrors the
  `embedContents`/`invalidatedEmbeds` handling — without it a promoted template snapshot survives
  `invalidateAll` and serves stale data).
- `walkChain` / `promoteInto`: extend `LayerKind` to `"block" | "embed" | "template"` and the
  `ownMapKey`/`invalidationKey` derivations (`template`→`templateContents`/`invalidatedTemplates`).
- New `getTemplateContentSnapshot(doc, id, cache): Block | null` mirroring
  `getEmbedContentSnapshot` (reads from `getTemplateContentsMap` on a miss).

- [ ] **Step 1: Write failing tests:** (a) a template snapshot read caches (second read returns
  the same `Block` ref); (b) `invalidateSnapshot` + re-read returns a FRESH snapshot reflecting a
  Y.Doc mutation; (c) after `compactCache` with the template id NOT in dirtyIds, the template
  snapshot survives the compaction. To avoid a vacuous pass (M1), SEED it for real: read the
  template snapshot once (populating a pre-compaction layer), spy on
  `getTemplateContentsMap(doc).get`, `compactCache` with an UNRELATED dirtyId, read again, and
  assert the spy was NOT called (served from the compacted cache) — not merely ref-equality on an
  unpopulated cache. (d) after `compactCache` WITH the template id in dirtyIds, the next read
  re-snapshots (spy IS called). Mirror the existing embed snapshot tests.
- [ ] **Step 2: Run, confirm fail.**
- [ ] **Step 3: Implement** all the above.
- [ ] **Step 4: Run tests + build + full suite** (snapshot is consumed widely; confirm no regress).
- [ ] **Step 5: Commit** (controller, post-review).

## Task 4: `state.ts` — accessors + `resolveBlock`

**Files:** Modify `packages/core/src/state/state.ts`; Test: `packages/core/src/state/state.test.ts`.

- `getTemplateContent(state, id): Block | null` → `getTemplateContentSnapshot(internal.doc, id, internal.snapshotCache)` (mirror `getEmbedContent`).
- `getTemplateContentIds(state): IterableIterator<BlockId>` → `getTemplateContentsMap(...).keys()` (mirror `getEmbedContentIds`).
- `resolveBlock(state, id): { block: Block; kind: "block" | "embedContent" | "templateContent" } | null`:
  check `getBlock` → kind "block"; else `getEmbedContent` → "embedContent"; else
  `getTemplateContent` → "templateContent"; else `null`. (Main tree precedence, matching
  `getBlockFromEither`.) Keep `getBlockFromEither` as the value-only shortcut (existing callers).

- [ ] **Step 1: Write failing tests:** build a state with a body block, an embed body, and a
  template body; assert `resolveBlock` returns `kind` `"block"`/`"embedContent"`/`"templateContent"`
  respectively, `null` for an unknown id, and that `.block` is the same value `getBlock`/
  `getEmbedContent`/`getTemplateContent` return. Assert `getBlockFromEither` still resolves
  body+embed (unchanged).
- [ ] **Step 2: Run, confirm fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests + build + full suite.**
- [ ] **Step 5: Commit** (controller, post-review).

## Task 5: `render.ts` — `RenderOutput.templateContents` + render loops

**Files:** Modify `packages/core/src/render/render.ts`; Test: `packages/core/src/render/render.test.ts`.

- `RenderOutput`: add `readonly templateContents: ReadonlyMap<BlockId, RenderNode>;`.
- `render(...)`: after the `embedContents` render loop, add a parallel loop over
  `getTemplateContentIds(state)` rendering each template body root into a `RenderNode` (no parent
  computed style — same as embeds), collected into the new map.
- `renderIncremental(...)`: mirror the embed-contents incremental re-render loop for template
  contents (re-render only template bodies whose root id ∈ dirtyIds; reuse prior RenderNodes
  otherwise). Verify the prev `RenderOutput.templateContents` is threaded as the reuse source.

- [ ] **Step 1: Write failing tests:** (a) `render(state, …)` on a state with a seeded template
  body produces a `templateContents` map whose entry is a RenderNode tree for that body; (b)
  `renderIncremental` with a dirtyId in the template body re-renders ONLY that body (assert the
  unchanged body's RenderNode is reused by ref); (c) a state with no template bodies yields an
  empty `templateContents` map and is otherwise unchanged (no regression to `root`/`embedContents`).
- [ ] **Step 2: Run, confirm fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests + build + FULL core + dom suites** (RenderOutput is consumed by the
  layout coordinator + dom; adding a field is additive but confirm no consumer breaks).
- [ ] **Step 5: Commit** (controller, post-review).

---

## Out of scope for C.2a (do NOT build here)

- Any block REFERENCING templateContents (section attrs header/footer body refs) → C.2c.
- Layer-3 ops that WRITE templateContents (header-edit / create) → C.2c.
- Cascade of template bodies into `cascadedTemplateContents` → C.2c (C.2a only produces the
  `RenderOutput.templateContents` render nodes; cascade wiring is C.2c).
- Cascade-delete of template bodies on section removal → C.2c.
- `resolveBlock`'s consumers (cursor/hit-test/selection scope) → C.2c.
- The single-invalidation-set unification (could replace the three `invalidated*` sets since ids
  are globally unique) — out of scope; mirror the existing per-tree pattern. Relates to #273.

## Self-review (writing-plans checklist)

- **Spec coverage:** every C.2a extension point from the spec's "C.2a detail" is a task —
  yjs-doc (T1), history (T2), snapshot incl. compactCache (T3), state + resolveBlock (T4), render
  full+incremental (T5). ✓
- **Type names consistent:** `getTemplateContentsMap`, `getTemplateContent(Ids)`,
  `getTemplateContentSnapshot`, `templateContents`/`invalidatedTemplates`, `kind:"templateContent"`,
  `LayerKind:"template"` used identically across tasks. ✓
- **Placeholders:** none — each task lists concrete functions/signatures + enumerated tests. The
  test-seeding approach is specified up front (no Layer-3 writer exists). ✓
- **Ordering:** T1 (map + dirty) → T2 (undo) → T3 (snapshot) → T4 (accessors, depends on T3's
  getTemplateContentSnapshot) → T5 (render, depends on T4's getTemplateContentIds). Foundations
  first; each task builds + tests green independently.
