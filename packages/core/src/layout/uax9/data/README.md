# Vendored Unicode data (UAX #9 bidi)

These files are **build-time inputs only** — they are NOT shipped in `dist`
(the runtime ships only the generated `../bidi-class-table.ts`). They are read
by `scripts/gen-uax9-table.ts` (table generation) and by the test suite
(regeneration-drift; bracket/mirroring consumers land in later tasks).

**Unicode version: 16.0.0** (all files must be the same version).

| File | Source URL |
|---|---|
| `DerivedBidiClass.txt` | https://www.unicode.org/Public/16.0.0/ucd/extracted/DerivedBidiClass.txt |
| `BidiBrackets.txt` | https://www.unicode.org/Public/16.0.0/ucd/BidiBrackets.txt |
| `BidiMirroring.txt` | https://www.unicode.org/Public/16.0.0/ucd/BidiMirroring.txt |
| `BidiTest.txt` | https://www.unicode.org/Public/16.0.0/ucd/BidiTest.txt |
| `BidiCharacterTest.txt` | https://www.unicode.org/Public/16.0.0/ucd/BidiCharacterTest.txt |

`DerivedBidiClass.txt` supplies the `Bidi_Class` property. Its `@missing`
annotations assign default bidi classes to *unassigned* code points in certain
ranges (e.g. unassigned chars in the Hebrew/Arabic blocks default to
`R`/`AL`/`AN`/`ET`, not the overall `L` default); the generator applies those
`@missing` ranges as a base layer, then overlays the explicit assignments, so
`bidiClass(cp)` resolves correctly for unassigned code points too.

`BidiBrackets.txt` (paired-bracket property, for the UAX #9 BD16 / N0 rules) and
`BidiMirroring.txt` (mirrored-glyph property) are vendored now and consumed by
later tasks.

`BidiTest.txt` (class-sequence cases, `@Levels`/`@Reorder` directives) and
`BidiCharacterTest.txt` (explicit-codepoint cases) are the official UAX #9
conformance suites, consumed by `../conformance.test.ts`. Both run in full; the
harness reconciles our §5.2 RETAINING model (explicit-format + BN kept) against
the oracle's REMOVING model by compacting away the `x`-marked positions before
the L1/L2 comparison.

Regenerate the table after a Unicode upgrade with: `npm run gen:uax9`
(then run the test suite; the regeneration-drift test guards against hand-edits).
