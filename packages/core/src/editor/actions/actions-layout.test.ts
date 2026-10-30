/**
 * The `actions/` layout: one file per action, `actions/<action-type>.ts`, exporting only
 * `handle<ActionType>`; everything else an action reuses lives in `actions/helpers/`, one
 * exported function per file (plus the constants / types it owns).
 */
import { describe, it, expect } from "vitest";

interface NodeFs {
  readFileSync(path: string, encoding: "utf8"): string;
  readdirSync(path: string): string[];
  statSync(path: string): { isDirectory(): boolean };
}
interface NodePath {
  join(...parts: string[]): string;
}
declare const __dirname: string;
declare function require(id: "fs"): NodeFs;
declare function require(id: "path"): NodePath;
const { readFileSync, readdirSync, statSync } = require("fs");
const { join } = require("path");

const actionsDir = __dirname; // packages/core/src/editor/actions
const helpersDir = join(actionsDir, "helpers");

const pascal = (type: string): string =>
  type.toLowerCase().split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");
const kebab = (type: string): string => type.toLowerCase().replace(/_/g, "-");
const isSource = (f: string): boolean => f.endsWith(".ts") && !/\.(test|bench)\.ts$/.test(f);

/** `[kind, name]` of each top-level export (`export { … }` re-exports count as "re-export"). */
function exportsOf(file: string): Array<[string, string]> {
  const src = readFileSync(file, "utf8");
  const named = [...src.matchAll(/^export (?:declare )?(function|const|let|class|type|interface|enum) ([A-Za-z0-9_]+)/gm)].map(
    (m): [string, string] => [m[1] ?? "", m[2] ?? ""],
  );
  const reexports = [...src.matchAll(/^export (?:type )?\{/gm)].map((): [string, string] => ["re-export", "{…}"]);
  return [...named, ...reexports];
}

/** The action types and their handlers, read from the reducer's `ACTIONS` table. */
const reducer = readFileSync(join(actionsDir, "../reduce-editor.ts"), "utf8");
const table = reducer.slice(reducer.indexOf("const ACTIONS"));
const entries = [...table.matchAll(/^ {2}([A-Z_]+): \{ (?:edit|reduce): ([A-Za-z]+)/gm)].map((m) => ({
  type: m[1] ?? "",
  handler: m[2] ?? "",
}));

describe("actions/ layout", () => {
  it("reads every action from the ACTIONS table", () => {
    expect(entries.length).toBeGreaterThan(80);
  });

  it("each action is handled by handle<ActionType>, alone in actions/<action-type>.ts", () => {
    for (const { type, handler } of entries) {
      expect(handler, type).toBe("handle" + pascal(type));
      expect(exportsOf(join(actionsDir, kebab(type) + ".ts")), type).toEqual([["function", handler]]);
    }
  });

  it("actions/ holds nothing but action handlers (the rest is in actions/helpers/)", () => {
    const handlerFiles = new Set(entries.map(({ type }) => kebab(type) + ".ts"));
    const others = readdirSync(actionsDir).filter(
      (f) => isSource(f) && !statSync(join(actionsDir, f)).isDirectory() && !handlerFiles.has(f) && f !== "index.ts" && f !== "test-helpers.ts",
    );
    expect(others).toEqual([]);
  });

  it("each actions/helpers/ file exports one function (plus the constants / types it owns)", () => {
    for (const f of readdirSync(helpersDir).filter(isSource)) {
      const exports = exportsOf(join(helpersDir, f));
      expect(exports.filter(([kind]) => kind === "function"), f).toHaveLength(1);
      const extra = exports.filter(
        ([kind, name]) => kind !== "function" && kind !== "type" && kind !== "interface" && !(kind === "const" && /^[A-Z][A-Z0-9_]*$/.test(name)),
      );
      expect(extra, f).toEqual([]);
    }
  });
});
