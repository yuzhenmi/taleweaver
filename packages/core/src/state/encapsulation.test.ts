/**
 * Compile-time guard: State's public type surface must not expose `doc`
 * or `snapshotCache`. The `@ts-expect-error` directives below FAIL the
 * `npm run build --workspace=packages/core` step if either field ever
 * becomes accessible at the public type level. This is the canonical
 * encapsulation breach defense — if you find yourself wanting to delete
 * one of these directives, you are breaking the rule documented in
 * `docs/architecture/1-core/1.1-state.md` (Yjs encapsulation) and must
 * STOP and surface for coordination.
 */
import { describe, it, expect } from "vitest";
import type { State } from "./state";
import { createState } from "./state";
import { createYDoc, getMetaMap } from "./yjs-doc";
import type { BlockId } from "./block-id";

// --- Minimal Node `fs`/`path` surface for the A13 source-scan meta-test.
//
// The `@taleweaver/core` build compiles for browsers, so its tsconfig
// deliberately omits `@types/node` (no `node:fs` module types, no
// `__dirname`/`require` globals). The A13 test reads source files off
// disk under Node (vitest), so we declare exactly the surface we touch
// rather than pull `@types/node` into the whole package's typecheck. This
// stays self-contained to this test file and uses no `as any`.
interface DirEnt {
  readonly name: string;
  isDirectory(): boolean;
  isFile(): boolean;
}
interface NodeFs {
  readdirSync(path: string, opts: { withFileTypes: true }): DirEnt[];
  readFileSync(path: string, encoding: "utf8"): string;
}
interface NodePath {
  join(...parts: string[]): string;
  resolve(...parts: string[]): string;
}
declare const __dirname: string;
declare function require(id: "fs"): NodeFs;
declare function require(id: "path"): NodePath;
const { readdirSync, readFileSync } = require("fs");
const { join, resolve } = require("path");

// --- Type-only assertions. These are checked at `npm run build` time.
//
// `declare` symbols never exist at runtime, so this block never executes.
// The `@ts-expect-error` directives must point at expressions that WOULD
// be type errors; if doc / snapshotCache ever leaked back onto the public
// type surface, the directives would become "unused suppressions" and
// `tsc` would fail. That is the encapsulation guard.
declare const __phantom_state__: State;
// @ts-expect-error — doc is not part of State's public type surface;
// it lives behind STATE_INTERNAL and is reachable only from inside state/.
type _ProvesDocIsPrivate = typeof __phantom_state__.doc;
// @ts-expect-error — snapshotCache is also private; same reasoning as doc.
type _ProvesSnapshotCacheIsPrivate = typeof __phantom_state__.snapshotCache;

// Reference the local type aliases so `noUnusedLocals` doesn't flag them.
// (They exist purely for the directive payload.)
type _Used = _ProvesDocIsPrivate | _ProvesSnapshotCacheIsPrivate;

describe("State encapsulation (runtime)", () => {
  it("rootId is the only enumerable string-keyed field on State", () => {
    // Runtime sanity: the public-accessible keys are { rootId }. The
    // internal {doc, snapshotCache} live behind a Symbol and so do not
    // appear via Object.keys / for..in / spread. (Symbol-keyed props
    // are still enumerable via Reflect.ownKeys; that's expected — the
    // encapsulation is type-level, not a runtime sandbox.)
    const state = createState({ rootId: "root" as BlockId });
    expect(Object.keys(state)).toEqual(["rootId"]);
    // Throwaway reference so the `_Used` alias survives strict checks.
    const _ignore: _Used | undefined = undefined;
    expect(_ignore).toBeUndefined();
  });
});

// --- A13: `freshStateFromDoc` is an escape hatch with NO production callers.
//
// `freshStateFromDoc` (state.ts) mints a State with a completely empty
// snapshot cache and no overlay continuity — using it in production defeats
// the per-State view-stability + structural-sharing properties of the
// snapshot cache (the production undo/redo path uses `freshState(state,
// dirtyIds)` instead). Its docstring declares it test-fixture-only. This
// meta-test enforces that docstring as CI: it walks the source of
// `packages/core/src` and `packages/print/src`, and asserts no NON-test,
// non-sanctioned `.ts` file imports the identifier.
//
// Sanctioned files: the definition (`state.ts`) and the barrel that
// re-exports it (`state/index.ts`). Everything else is "production" for the
// purposes of this guard.

const ESCAPE_HATCH_IDENTIFIER = "freshStateFromDoc";

// This test file lives at packages/core/src/state/encapsulation.test.ts.
const STATE_DIR = resolve(__dirname); // packages/core/src/state
const CORE_SRC_DIR = resolve(STATE_DIR, ".."); // packages/core/src
const PACKAGES_DIR = resolve(CORE_SRC_DIR, "..", ".."); // packages
const PRINT_SRC_DIR = resolve(PACKAGES_DIR, "print", "src"); // packages/print/src

// Files that LEGITIMATELY define / re-export the identifier.
const SANCTIONED_FILES = new Set<string>([
  resolve(STATE_DIR, "state.ts"),
  resolve(STATE_DIR, "index.ts"),
]);

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectTsFiles(full));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!full.endsWith(".ts")) continue;
    if (full.endsWith(".test.ts")) continue; // tests may use the escape hatch
    out.push(full);
  }
  return out;
}

/**
 * True if `source` contains an `import` statement that pulls in the
 * `identifier` binding. Matches both `import { …, identifier, … } from "…"`
 * and the multiline brace form. Deliberately conservative: it only flags a
 * real import binding, not an incidental textual mention (e.g. in a comment
 * or docstring), so the sanctioned-file list stays small.
 */
function importsIdentifier(source: string, identifier: string): boolean {
  // Match `import ... { ... identifier ... } ... from "..."`, allowing
  // newlines inside the brace group. The identifier must appear as a whole
  // word inside the braces (optionally aliased: `identifier as foo`).
  const importRe = new RegExp(
    String.raw`import\b[^;]*\{[^}]*\b${identifier}\b[^}]*\}[^;]*from`,
    "s",
  );
  return importRe.test(source);
}

/**
 * True if `source` reaches the identifier via MEMBER ACCESS — i.e. a
 * namespace import (`import * as s from "./state"`) followed by
 * `s.freshStateFromDoc(...)`. The named-import scan above (`importsIdentifier`)
 * only catches `import { freshStateFromDoc }`; a namespace import binds the
 * module object under an arbitrary alias, so the call site reads
 * `<alias>.freshStateFromDoc` instead. We flag that member-access form
 * directly: `.` (optional whitespace) then the identifier as a whole word.
 * Matching member access avoids false-positiving on the bare identifier in
 * the sanctioned definition file (which is excluded anyway) while still
 * catching the namespace-alias escape route.
 */
function usesIdentifierViaMemberAccess(
  source: string,
  identifier: string,
): boolean {
  const memberRe = new RegExp(String.raw`\.\s*${identifier}\b`);
  return memberRe.test(source);
}

describe(`A13: ${ESCAPE_HATCH_IDENTIFIER} escape hatch has no production callers`, () => {
  it("is not imported by any non-test production file in core/ or print/", () => {
    const files = [
      ...collectTsFiles(CORE_SRC_DIR),
      ...collectTsFiles(PRINT_SRC_DIR),
    ];

    const offenders: string[] = [];
    for (const file of files) {
      if (SANCTIONED_FILES.has(file)) continue;
      const source = readFileSync(file, "utf8");
      if (
        importsIdentifier(source, ESCAPE_HATCH_IDENTIFIER) ||
        usesIdentifierViaMemberAccess(source, ESCAPE_HATCH_IDENTIFIER)
      ) {
        offenders.push(file);
      }
    }

    // If this fails, a production file imported the escape hatch. Use
    // `freshState(state, dirtyIds)` instead (see state.ts docstring), or —
    // if the import is genuinely sanctioned — add it to SANCTIONED_FILES
    // with a justification.
    expect(offenders).toEqual([]);
  });
});

// --- A14: doc-meta map holds ONLY the immutable `rootId`.
//
// The meta Y.Map is intentionally outside the History UndoManager's tracked
// scopes (see `getMetaMap` docstring): any mutable field placed there would
// silently fall out of undo/redo. This whitelist test fails the moment a new
// key appears in doc-meta, forcing a decision (immutable → fine; mutable →
// must live under a tracked Layer-3 map).

const DOC_META_WHITELIST = ["rootId"];

describe("A14: doc-meta immutability whitelist", () => {
  it("a freshly constructed State's doc-meta holds only rootId", () => {
    // Build the doc explicitly so we can reach its meta map (the State's
    // Y.Doc is private behind STATE_INTERNAL; createState reuses the doc we
    // pass in, so the meta map we inspect is exactly the State's).
    const doc = createYDoc({ rootId: "root" as BlockId });
    createState({ rootId: "root" as BlockId, doc });

    const meta = getMetaMap(doc);
    expect([...meta.keys()].sort()).toEqual([...DOC_META_WHITELIST].sort());
  });
});
