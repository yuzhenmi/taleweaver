# Vendored Unicode data (UAX #14 line-break)

These files are **build-time inputs only** — they are NOT shipped in `dist`
(the runtime ships only the generated `../line-break-table.ts`). They are read
by `scripts/gen-uax14-table.ts` (table generation) and by the test suite
(conformance + regeneration-drift).

**Unicode version: 16.0.0** (all files must be the same version).

| File | Source URL |
|---|---|
| `LineBreak.txt` | https://www.unicode.org/Public/16.0.0/ucd/LineBreak.txt |
| `DerivedGeneralCategory.txt` | https://www.unicode.org/Public/16.0.0/ucd/extracted/DerivedGeneralCategory.txt |
| `EastAsianWidth.txt` | https://www.unicode.org/Public/16.0.0/ucd/EastAsianWidth.txt |
| `emoji-data.txt` | https://www.unicode.org/Public/16.0.0/ucd/emoji/emoji-data.txt |
| `LineBreakTest.txt` | https://www.unicode.org/Public/16.0.0/ucd/auxiliary/LineBreakTest.txt |

`emoji-data.txt` supplies the `Extended_Pictographic` property; intersected with
`General_Category=Cn` (from `DerivedGeneralCategory.txt`) it produces the
`EXTENDED_PICTOGRAPHIC_CN_RANGES` table for the LB30b 2nd clause
(`[\p{Extended_Pictographic} & \p{gc=Cn}] × EM`).

Regenerate the table after a Unicode upgrade with: `npm run gen:uax14`
(then run the test suite; the regeneration-drift test guards against hand-edits).
