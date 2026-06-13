/**
 * Regeneration-drift guard: each committed generated table
 * (`bidi-class-table.ts`, `bidi-mirror-table.ts`, `bidi-bracket-table.ts`) must
 * byte-equal a fresh run of `scripts/gen-uax9-table.ts`. This catches hand-edits
 * to any generated table and non-determinism in the codegen.
 *
 * --- Minimal Node surface ---
 * The `@taleweaver/core` build compiles for browsers, so its tsconfig
 * deliberately omits `@types/node` (no `node:fs` module types, no
 * `require`/`process`/`__dirname` globals). This test runs under Node (vitest),
 * so — mirroring `state/encapsulation.test.ts` — we declare exactly the Node
 * surface we touch rather than pull `@types/node` into the whole package's
 * typecheck. Self-contained to this file; uses no `as any`.
 */
import { describe, it, expect } from "vitest";

interface NodeFs {
  readFileSync(path: string, encoding: "utf8"): string;
  mkdtempSync(prefix: string): string;
  rmSync(path: string, opts: { recursive: boolean; force: boolean }): void;
}
interface ExecFileSyncOptions {
  cwd: string;
  stdio: "pipe";
  env: Record<string, string | undefined>;
}
interface NodeChildProcess {
  execFileSync(file: string, args: string[], opts: ExecFileSyncOptions): void;
}
interface NodePath {
  join(...parts: string[]): string;
}
interface NodeOs {
  tmpdir(): string;
}
declare const __dirname: string;
declare const process: { env: Record<string, string | undefined> };
declare function require(id: "fs"): NodeFs;
declare function require(id: "child_process"): NodeChildProcess;
declare function require(id: "path"): NodePath;
declare function require(id: "os"): NodeOs;
const { readFileSync, mkdtempSync, rmSync } = require("fs");
const { execFileSync } = require("child_process");
const { join } = require("path");
const { tmpdir } = require("os");

const here = __dirname; // packages/core/src/layout/uax9
const repoRoot = join(here, "../../../../.."); // → repo root
const script = join(repoRoot, "scripts/gen-uax9-table.ts");

// All three tables the generator emits. A hand-edit to ANY of them must fail.
const GENERATED_TABLES = [
  "bidi-class-table.ts",
  "bidi-mirror-table.ts",
  "bidi-bracket-table.ts",
];

describe("uax9 generated tables", () => {
  it("committed tables byte-equal a fresh codegen run (no hand-edits / no drift)", () => {
    // Generate into a TEMP DIRECTORY via UAX9_OUT so the committed sources are
    // never mutated by running the test (a failing test must not leave a dirty
    // tree). UAX9_OUT denotes the output directory; the generator writes all
    // three *-table.ts files into it.
    const tmp = mkdtempSync(join(tmpdir(), "uax9-"));
    try {
      execFileSync("node", [script], {
        cwd: repoRoot,
        stdio: "pipe",
        env: { ...process.env, UAX9_OUT: tmp },
      });
      for (const name of GENERATED_TABLES) {
        const fresh = readFileSync(join(tmp, name), "utf8");
        const committedContent = readFileSync(join(here, name), "utf8");
        expect(fresh, `${name} drift`).toBe(committedContent);
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
