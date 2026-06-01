// Minimal global typing for `performance.now()` so packages/core can use
// it without pulling in the full DOM lib. `performance` is available in
// Node 16+ and every browser; we only consume `now()`.
declare const performance: {
  now(): number;
};
