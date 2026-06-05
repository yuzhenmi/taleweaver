/**
 * Regeneration-drift guard: the committed `line-break-table.ts` must byte-equal
 * a fresh run of `scripts/gen-uax14-table.ts`. This catches hand-edits to the
 * generated table and non-determinism in the codegen.
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

const here = __dirname; // packages/core/src/layout/uax14
const repoRoot = join(here, "../../../../.."); // → repo root
const committed = join(here, "line-break-table.ts");
const script = join(repoRoot, "scripts/gen-uax14-table.ts");

describe("line-break-table (generated)", () => {
  it("committed table byte-equals a fresh codegen run (no hand-edits / no drift)", () => {
    // Generate to a TEMP path via UAX14_OUT so the committed source is never
    // mutated by running the test (a failing test must not leave a dirty tree).
    const tmp = mkdtempSync(join(tmpdir(), "uax14-"));
    const tmpOut = join(tmp, "line-break-table.ts");
    try {
      execFileSync("node", [script], {
        cwd: repoRoot,
        stdio: "pipe",
        env: { ...process.env, UAX14_OUT: tmpOut },
      });
      const fresh = readFileSync(tmpOut, "utf8");
      const committedContent = readFileSync(committed, "utf8");
      expect(fresh).toBe(committedContent);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
