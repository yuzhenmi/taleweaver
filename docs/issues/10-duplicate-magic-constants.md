# Issue 10 — Magic constants duplicated across modules (Minor)

## Summary

The same numeric values (notably `500` for both history depth and merge
threshold) appear in two unrelated files with two different names.
Either could be changed without the other.

## Where it manifests

`packages/core/src/state/history.ts:5–8`:

```ts
const COLLAPSE_THRESHOLD_MS = 500;
const DEFAULT_MAX_DEPTH = 500;
```

`packages/core/src/editor/editor-state.ts:52–53`:

```ts
const MAX_HISTORY_DEPTH = 500;
const MERGE_THRESHOLD_MS = 500;
```

Plus other "magic numbers" sprinkled around:

- `packages/dom/src/editor-controller.ts:27–28`:

  ```ts
  const DEFAULT_PAGE_GAP = 24;
  const SCROLL_DURATION = 250;
  ```

- The cursor blink interval `500` is inline in
  `editor-controller.ts:241`.
- The scroll padding `64` is inline in
  `editor-controller.ts:285`.

## Why it's a problem

1. **Drift risk.** Tweak one, miss the other.
2. **Configurability is opaque.** The blink interval, scroll duration,
   and history depth probably should be configurable for
   accessibility/personal preference reasons; right now they're
   hard-coded literals scattered across files.
3. **Docs become harder.** When someone asks "how long is the
   coalescing window for typing into one undo step?" you have to grep.

## Fix options

### Option A — single `constants.ts` per package

Hoist into one file per package:

```ts
// packages/core/src/constants.ts
export const HISTORY_MAX_DEPTH = 500;
export const HISTORY_MERGE_THRESHOLD_MS = 500;
```

```ts
// packages/dom/src/constants.ts
export const DEFAULT_PAGE_GAP = 24;
export const CURSOR_BLINK_INTERVAL_MS = 500;
export const SCROLL_DURATION_MS = 250;
export const SCROLL_PADDING_PX = 64;
```

Pros: trivial to find; trivial to maintain.
Cons: pulls modules into a slight central dependency.

### Option B — config object on `EditorConfig`

Make the values configurable, with sensible defaults:

```ts
interface EditorConfig {
  ...
  historyMaxDepth?: number;
  historyMergeThresholdMs?: number;
  cursorBlinkIntervalMs?: number;
}
```

Pros: consumers can tune; accessibility win.
Cons: more API surface. Most users won't tune these.

### Option C — combo: A for pure code reuse, B only where needed

Hoist with named exports (Option A). Selectively expose via config any
of them that have a real use case for being configurable
(`cursorBlinkIntervalMs` for accessibility makes sense; history depth
also).

**Recommendation:** Option C.

## Migration plan

1. Create `packages/core/src/constants.ts` and
   `packages/dom/src/constants.ts`.
2. Move the constants over.
3. Replace inline literals (`500` for blink, `64` for scroll padding)
   with named imports.
4. For each constant, decide if it should be config-overridable. Add
   to `EditorConfig` / `EditorControllerOptions` if so, defaulting to
   the constant.
5. Document.

## Test impact

- No behavior change. Tests should pass unchanged.
- Optionally add a smoke test that verifies override works for the
  configurable ones.

## See also

- [issue 06](06-duplicate-history-systems.md) — the duplication of
  `500` is partly because there are two history systems. Consolidating
  them removes one constant.
