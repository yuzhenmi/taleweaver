/**
 * UAX #14 conformance: every case in the vendored `LineBreakTest.txt` (Unicode
 * 16.0.0) must match `lineBreakOpportunities` exactly. This is the correctness
 * gate for the rule engine.
 *
 * --- Minimal Node surface ---
 * `@taleweaver/core` compiles for browsers, so its tsconfig omits `@types/node`.
 * This test runs under Node (vitest's default forks pool), so — mirroring
 * `line-break-table.test.ts` / `state/encapsulation.test.ts` — we declare exactly
 * the Node surface we touch instead of pulling `@types/node` into the package.
 * Self-contained; no `as any`, no `!`.
 */
import { describe, it, expect } from "vitest";
import { lineBreakOpportunities } from "./break-opportunities";

interface NodeFs {
  readFileSync(path: string, encoding: "utf8"): string;
}
interface NodePath {
  join(...parts: string[]): string;
}
declare const __dirname: string;
declare function require(id: "fs"): NodeFs;
declare function require(id: "path"): NodePath;
const { readFileSync } = require("fs");
const { join } = require("path");

const here = __dirname; // packages/core/src/layout/uax14
const testFile = join(here, "data/LineBreakTest.txt");

interface ConformanceCase {
  text: string;
  breaks: Set<number>;
}

/**
 * Parse one LineBreakTest.txt line of the form:
 *   ÷ 0023 × 0020 ÷ 0041 ÷   # comment
 * `÷` = break allowed at this boundary, `×` = no break. Returns the text and
 * the set of code-unit offsets where a break is EXPECTED (excluding offset 0 and
 * end-of-text).
 */
function parseCase(line: string): ConformanceCase | null {
  const body = (line.split("#")[0] ?? "").trim();
  if (body === "") return null;
  const toks = body.split(/\s+/);
  let text = "";
  const breaks = new Set<number>();
  // toks alternate: <marker> <hex> <marker> <hex> ... <marker>
  for (let t = 0; t < toks.length; t++) {
    const tok = toks[t];
    if (tok === undefined) throw new Error(`malformed LineBreakTest line: missing token at ${t}`);
    if (tok === "÷" || tok === "×") {
      if (t > 0 && tok === "÷") breaks.add(text.length); // break BEFORE next cp
      continue;
    }
    const cp = parseInt(tok, 16);
    text += String.fromCodePoint(cp);
  }
  breaks.delete(0);           // LB2: never a break at start
  breaks.delete(text.length); // end-of-text is not an emitted opportunity
  return { text, breaks };
}

describe("UAX #14 conformance (LineBreakTest.txt, Unicode 16.0.0)", () => {
  const lines = readFileSync(testFile, "utf8").split("\n");
  const cases = lines
    .map(parseCase)
    .filter((c: ConformanceCase | null): c is ConformanceCase => c !== null);

  it("parses a non-trivial number of conformance cases", () => {
    expect(cases.length).toBeGreaterThan(1000);
  });

  it("matches every LineBreakTest.txt case exactly", () => {
    const failures: string[] = [];
    for (const { text, breaks } of cases) {
      const got = new Set(lineBreakOpportunities(text).map((p) => p.index));
      const expected = breaks;
      const same = got.size === expected.size && [...expected].every((x) => got.has(x));
      if (!same) {
        failures.push(
          `text=${JSON.stringify(text)} cps=[${[...text]
            .map((c) => (c.codePointAt(0) ?? 0).toString(16))
            .join(",")}] ` +
            `expected={${[...expected].sort((a, b) => a - b)}} got={${[...got].sort((a, b) => a - b)}}`,
        );
        if (failures.length >= 20) break; // cap output
      }
    }
    expect(failures, `\n${failures.join("\n")}`).toHaveLength(0);
  });
});
