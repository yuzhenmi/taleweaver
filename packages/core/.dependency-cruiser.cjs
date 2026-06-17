// dependency-cruiser config — @taleweaver/core stays HEADLESS and package-clean.
//
// After dual-mode Phase 3 Commit A, the geometric layout engine + geometry-
// dependent cursor math moved OUT of core into @taleweaver/print. core is now a
// separately-publishable headless package: its PRODUCTION source must import NO
// sibling @taleweaver package (and transitively no DOM/canvas). This rule is the
// mechanical guard for that. TESTS / test-utils / integration are EXEMPT — they
// legitimately import @taleweaver/print to exercise the relocated engine.
const TEST_EXCLUDE = "(\\.test\\.ts$|test-helpers\\.ts$|/test-utils/|/integration/)";

module.exports = {
  forbidden: [
    {
      name: "core-no-sibling-packages",
      severity: "error",
      comment:
        "@taleweaver/core is the headless brain; its production source must not " +
        "import any sibling package (print/digital/pdf/react). Geometry lives in " +
        "@taleweaver/print after dual-mode Phase 3.",
      from: { path: "^src/", pathNot: TEST_EXCLUDE },
      // The workspace dep `@taleweaver/<pkg>` resolves through a symlink to the
      // sibling package's build output, so depcruiser records the edge's
      // resolved path as `../<pkg>/dist/...` (or `node_modules/@taleweaver/
      // <pkg>/...` if unbuilt). Match every shape the resolver can produce:
      // the bare `@taleweaver/<pkg>` module specifier, the node_modules symlink
      // form, and the resolved `../<pkg>/dist|src/...` form.
      to: {
        path:
          "(@taleweaver/(print|digital|pdf|react)" +
          "|node_modules/@taleweaver/(print|digital|pdf|react)" +
          "|(^|/)(print|digital|pdf|react)/(dist|src)/)",
      },
    },
  ],
  options: {
    tsConfig: { fileName: "tsconfig.json" },
    // Follow `import type` edges: a core `import type { X } from "@taleweaver/print"`
    // still forces core's emitted .d.ts to reference print, a real build dep.
    tsPreCompilationDeps: true,
    doNotFollow: { path: "node_modules" },
    exclude: TEST_EXCLUDE,
  },
};
