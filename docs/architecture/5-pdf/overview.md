# `@taleweaver/pdf` — PDF export

`@taleweaver/pdf` turns a positioned layout tree into a PDF byte stream. It is
a **layout-tree consumer** — a peer of the `2-print` canvas renderer, not a
`DocumentSerializer`. Where the canvas renderer walks a `PageBox` and paints
pixels, the PDF emitter walks the same `PageBox` and emits PDF content-stream
operators. Both read the engine's final geometry; neither re-derives it.

It is platform-agnostic (no DOM, no canvas, no Node APIs). It depends on
`@taleweaver/core` for layout-tree types (`PageBox`, `LayoutBox`, `ComputedStyle`)
plus a few shared core helpers it reuses rather than re-derives —
`physicalBorderSides` (border-side mapping) and `isOpenableLinkUrl` (link-scheme
safety). It also depends on `@taleweaver/print` for the `PrintPdfEmitInput` +
`PdfEmitter` bridge types: `createPdfEmitter` adapts a print `PrintPdfEmitInput`
into an `emitPdf` call, establishing the **one-way** `pdf → print` exporter
direction (`print` imports zero `pdf` symbols).

## Phase boundary

PDF export is built in whole-feature phases. **Phases (a) text + geometry, (b)
vector graphics, (c.1) the embedded-font object-graph machinery, (c.2a) the real
TrueType-glyf font provider, (c.2b) OpenType-CFF font embedding, (c.3) font
subsetting, (d.1) the image-XObject machinery, (d.2) FlateDecode stream
compression, (d.3b-1) JPEG `/DCTDecode` embedding, and (d.3b-2) in-package PNG
decode + embedding are implemented.** Later phases each land as their own whole
feature:

- **(a) text + geometry** *(implemented)* — multi-page PDF with the standard-14
  fonts (Helvetica / Times / Courier families), WinAnsi-encoded text placed at
  absolute per-cluster positions, correct MediaBox per page.
- **(b) graphics** *(implemented)* — backgrounds, per-side borders, horizontal
  rules, underline / line-through decorations, and tab leaders (dotted / dashed /
  solid) — the box-decoration the canvas renderer paints. All filled shapes (no
  strokes): rects via `re`+`f`, dots via 4-Bézier filled circles.
- **(c) embedded fonts** — CIDFont embedding + `ToUnicode` for full Unicode
  coverage and extractable text beyond WinAnsi. Built in sub-slices:
  - **(c.1) embedded-font machinery** *(implemented)* — the Type0 / CIDFontType2
    composite-font object graph (embedded `FontFile2` program + `/W` widths +
    `FontDescriptor` + `ToUnicode` CMap), written through the provider's
    `writeFontObjects` seam, with 2-byte (`Identity-H`) CID glyph selection. Unit-
    tested end-to-end with a mock embedded provider; std-14 and embedded fonts
    coexist in one document. This sub-slice carries no real TrueType parser, no font
    asset, and no subsetting — the mock supplies the program bytes + metrics; the
    real parser is (c.2a/c.2b) and subsetting is (c.3).
  - **(c.2a/c.2b) real embedded provider** *(implemented)* —
    `createEmbeddedFontProvider({ fonts })` parses a real font (both TrueType
    `glyf` flavour, sfnt version `0x00010000`, AND CFF-flavored OpenType, sfnt
    `OTTO`) and feeds the c.1 machinery actual cmap / widths / metrics / program
    bytes / `ToUnicode`. A pure-byte sfnt parser (`parseSfnt`) reads the shared
    head/hhea/maxp/hmtx/cmap/OS-2/post/name tables for both flavours and exposes
    a `glyphFormat: "glyf" | "cff"` discriminant. The composite-font graph branches
    on that discriminant (see "Embedded composite-font model" below):
    - **glyf** (c.2a) — `FontFile2` + a CIDFontType2 descendant with
      `/CIDToGIDMap /Identity` and an Identity ROS; the descendant CID equals the
      GID, so `/W` is selection-width only.
    - **cff** (c.2b) — `FontFile3` (`/Subtype /CIDFontType0C`) + a CIDFontType0
      descendant, no `/CIDToGIDMap`, the font's own ROS in `/CIDSystemInfo`. A
      mini CFF parser (`cff-parser.ts`) reads the `CFF ` table's INDEX / Top-DICT /
      String-INDEX / charset to detect CID-keyed fonts, build the GID→CID map, and
      resolve the ROS. The emitted content code is the **CID**: for a CID-keyed CFF
      the charset maps GID→CID; otherwise CID = GID. The CFF charstrings are not
      re-encoded; the embedded program is the SUBSET (see (c.3) below) — the used
      charstrings are copied verbatim and the unused are dropped.
    Either way `/W` and the `ToUnicode` CMap are keyed by the emitted code, and the
    page-emitter still places every cluster absolutely (embedding never changes
    geometry). Unknown families fall through to the standard-14 fallback; embedded +
    std-14 coexist in one document.
  - **(c.3) subsetting** *(implemented)* — the embedded program carries only the
    glyphs the document uses (plus GID 0 `.notdef`); every other glyph's OUTLINE is
    dropped. It follows the **ZERO-unused-outline approach**: GID/CID numbering is
    PRESERVED, so the cmap / hmtx / charset / CIDToGIDMap / `/W` / `ToUnicode` are
    all untouched — only the outline data shrinks. For `glyf`, `glyf`+`loca` are
    rebuilt keeping the used outlines plus their transitively-referenced
    composite-component outlines and zeroing the rest, then the sfnt is reassembled.
    For `cff`, the CharStrings INDEX is rebuilt (used charstrings verbatim, each
    unused replaced by a single `endchar`) and the whole `CFF ` table is re-emitted
    in canonical layout with fixed-width offset operands — copying the non-CharStrings
    structures verbatim at recomputed positions, with FontMatrix and other real DICT
    operands preserved byte-for-byte. A deterministic 6-uppercase-letter subset tag
    (`XXXXXX+`) prefixes `/BaseFont` and `/FontName` (PDF §9.6.4) so the subset never
    collides with the full font in a reader's cache. Separable future refinements
    (NOT degraded cuts): GID-renumber / table-overhead compaction (shrinking
    loca/hmtx/INDEX slots + dropping unused subrs), unused-table stripping
    (GSUB/GPOS/kern), and `/CIDSet` (PDF/A only).
  - CFF2 / variable fonts, color/bitmap OpenType outline tables (`COLR`/`CBDT`/
    `sbix`/`SVG `, clean-rejected), cmap formats 0/2/6, multi-face /
    synthetic-bold-italic, and complex-script shaping (GSUB/GPOS) are deferred
    whole features.
- **(d) images** — raster image XObjects. Built in sub-slices:
  - **(d.1) image-XObject machinery** *(implemented)* — opaque `DeviceRGB`
    Image XObjects (8 bits-per-component, unfiltered samples) written through the
    injected `PdfImageProvider` seam, placed via a `q <cm> cm /Im<n> Do Q` content
    operator (the cm reuses `rectYUp`, so the image renders upright with no y-flip).
    Per-page `/XObject` resource dict; dedup by `imageKey`; a grey `#f0f0f0`
    placeholder rect when the provider can't resolve a `src` OR when the src resolves
    to a valid-but-unsupported format (mirroring the canvas renderer's not-cached
    branch). Unit-tested with a mock image provider; image-free documents stay
    byte-identical (no `/XObject` key). No real image decode.
  - **(d.3b-1) in-package image provider + JPEG `/DCTDecode` embedding** *(implemented)* —
    `createImageProvider({ images })` (host supplies `src → source-file-bytes`;
    the package parses and embeds in-package, headless — mirrors
    `createEmbeddedFontProvider`). JPEG embedding is implemented via the PDF-native
    `/DCTDecode` filter: `jpeg-parser.ts`'s `parseJpeg` reads the `SOFn` marker for
    dims/precision/component-count and detects an Adobe `APP14` marker to identify
    inverted-CMYK images — yielding colorspace `DeviceGray`/`DeviceRGB`/`DeviceCMYK`
    and a `/Decode [1 0 1 0 1 0 1 0]` inversion flag for Adobe CMYK; the JPEG bytes
    are embedded **verbatim** (no pixel decode — the PDF renderer decodes via
    `/DCTDecode` natively). `PdfImageHandle` is now the minimal `{ imageKey }`;
    providers carry rich data privately in a `WeakMap`. `writeStream` skips its own
    `FlateDecode` compression when the caller's dict already declares a `/Filter` (so
    a pre-filtered `/DCTDecode` stream embeds without double-encoding).
  - **(d.3b-2) in-package PNG decode + embedding** *(implemented)* — PDF has no
    native PNG filter, so PNG is DECODED in-package (`png-parser.ts` → `png-decode.ts`)
    and re-embedded as a `/FlateDecode` Image XObject. `parsePng` validates the
    signature + IHDR and walks chunks (PLTE / tRNS / concatenated IDAT); `decodePng`
    inflates the IDAT via the d.3a `zlibDecompress`, reverses the 5 PNG scanline
    filters (None/Sub/Up/Average/Paeth), and resolves the color type to PDF samples:
    grayscale → `DeviceGray`, RGB → `DeviceRGB`, palette → `[/Indexed /DeviceRGB …]`,
    all at native `BitsPerComponent` (1/2/4/8). **Transparency:** an alpha channel
    (colorType 4/6) and palette `tRNS` become a separate 8-bit `DeviceGray` `/SMask`
    Image XObject; grayscale/RGB `tRNS` (a single transparent color) becomes a
    native-space color-key `/Mask [..]` array. 16-bit depth and Adam7 interlacing are
    loud-rejected (`MalformedImageError`) as separable refinements; CRC verification is
    deferred (inflate / unfilter / the IDAT Adler-32 still fail loudly on corruption).
  - non-RGB color spaces beyond `DeviceCMYK`/`DeviceGray`/`/Indexed`, 16-bit-depth and
    interlaced PNG, and PNG CRC verification are deferred refinements (loud-rejected,
    NOT degraded cuts).
- **(d.2) FlateDecode stream compression** *(implemented)* — a cross-cutting whole
  feature: all PDF stream payloads (font programs, image samples, content streams) are
  compressed with `/Filter /FlateDecode` (zlib/DEFLATE, RFC 1950 wrapper + RFC 1951
  fixed-Huffman v1 encoding with LZ77 hash-chain matching) when compression reduces
  size (a no-expansion guard falls back to storing the payload uncompressed). `/Length`
  is the compressed byte count; `/Length1` (e.g. the uncompressed font-program length)
  is preserved as-is. `pdf-parse.ts`'s `streamObject` inflates transparently (stored,
  fixed-Huffman, and dynamic-Huffman streams — a complete RFC 1951 decoder); throws on
  the reserved block type, a malformed dynamic header, or a truncated input. Codec
  modules: `zlib.ts` (Adler-32 checksum + RFC 1950 framing), `deflate.ts` (LZ77
  hash-chain compressor + fixed-Huffman + stored fallback), `inflate.ts` (decoder:
  stored + fixed-Huffman + dynamic-Huffman, RFC 1951 §3.2.7 — complete RFC 1951
  decoder), `flate-tables.ts` (canonical-Huffman builder; RFC 1951 fixed-Huffman
  tables; RFC 1951 length/distance tables), `bit-io.ts` (`BitWriter` / `BitReader`
  primitives). Deferred refinements (separable whole features, NOT degraded cuts):
  dynamic-Huffman ENCODE (deflate still emits fixed-Huffman only; better compression
  ratio than fixed-Huffman) and lazy LZ77 matching.
- **`/Link` hyperlink annotations** *(implemented)* — document hyperlinks export as
  clickable `/Link` annotations with a `/URI` action (ISO 32000-1 §12.5.6.5). The
  inline `link` attr is threaded onto the layout text run (`TextRunBox.link`); the
  page-emitter collects one `{ url, rect }` per laid-out linked run whose URL passes
  `isOpenableLinkUrl`, and `emit-pdf` writes one `/Link` annotation object per rect,
  appending `/Annots` to the page dict only when the page carries ≥1 link. Covers
  body + header/footer/footnote slots.
- **Internal `/GoTo` destination links** *(implemented)* —
  cross-ref atoms (`InlineBlockBox.targetId`) and TOC entries (`BlockBox.metadata.navTarget`)
  collect one `{ targetId, rect }` per `internalLinkRects` entry; `emit-pdf`, given an injected
  `EmitPdfInput.resolveInternalDestination(targetId) → { pageIndex, yTopPx, xLeftPx } | null`,
  writes a `/Link` with a `/GoTo` action (`/A << /S /GoTo /D [<pageObj> 0 R /XYZ x y 0] >>`)
  merged into the same `/Annots` array as the `/URI` annots. To let a page emit a forward
  reference to a later page's object, all page object ids are PRE-ALLOCATED before the per-page
  write loop. A `null` (broken target) or absent resolver yields no annot. The controller-side
  resolver (`makeInternalDestinationResolver`) is wired by `EditorController.exportToPdf`
  (see *App-facing PDF-export surface* in `state-of-branch.md`).
- **Outline / bookmarks** *(implemented)* — the document heading hierarchy exports as
  a clickable `/Outlines` bookmark tree. Core `buildPdfOutline` nests the headings by
  level and resolves each destination via the same `resolveGotoDestination` machinery
  the `/GoTo` links use; `emit-pdf` emits the `/Outlines` root + per-heading items. See
  [the Outline / bookmarks section](#outline--bookmarks).
- **Tagged-PDF accessibility** *(implemented)* — the document exports as a tagged PDF:
  a `/StructTreeRoot` of standard structure elements (`Document` → `H1..H6` / `P` /
  `L` → `LI` → {`Lbl`, `LBody`} / `Table` → `TR` → `TH`/`TD` / `Figure`), with page
  content wrapped in marked-content sequences (`/Span <</MCID n>> BDC … EMC`) and a
  `/ParentTree` correlating each `(page, mcid)` to its owning `StructElem` (via per-page
  `/StructParents`). The controller maps the core accessibility projection to the
  pdf-package structure model (`mapAccessibilityTree(buildAccessibilityTree(state))`)
  and passes it as `EmitPdfInput.structureTree`; `emit-pdf` derives the tagged-leaf
  block-id set, threads it to the page-emitter (activating the `/Span`/`/Artifact`
  tagging), collects per-page `structRefs`, and assembles the `StructElem` graph +
  `/MarkInfo << /Marked true >>`. Header/footer/HR/decorative-image content is an
  `/Artifact` (excluded from the tree). Absent `structureTree` ⇒ the output is
  byte-identical to the untagged baseline. `EmitPdfInput.lang` (a BCP-47 tag, e.g.
  `"en-US"`) writes a catalog `/Lang` entry when `structureTree` is present; absent
  or empty ⇒ no `/Lang` is emitted. See the *Tagged-PDF structure* sections in
  `pdf-structure.ts`, `page-emitter.ts`, and `emit-pdf.ts`.

## Module map

The pipeline is a stack of small, single-responsibility modules. Reading
bottom-up (each depends only on those below it):

- **`bit-io.ts`** — low-level bit-packing primitives. `BitWriter` appends
  variable-width integer fields to an output buffer LSB-first (required by RFC
  1951 DEFLATE); `BitReader` mirrors it for inflate. Both are zero-allocation
  inner-loop helpers consumed by the codec modules above them.
- **`flate-tables.ts`** — static DEFLATE tables and a canonical-Huffman builder.
  Provides the RFC 1951 fixed-Huffman literal/length and distance code tables,
  the RFC 1951 length-extra-bits and distance-extra-bits tables, and
  `buildCanonicalCodes` — a generic canonical-code-length-to-bit-pattern
  builder used by both the fixed-code paths and the dynamic-Huffman decoder.
- **`inflate.ts`** — RFC 1951 DEFLATE decompressor. Decodes stored (type-00),
  fixed-Huffman (type-01), and dynamic-Huffman (type-10, RFC 1951 §3.2.7) blocks —
  a complete RFC 1951 decoder. Throws on the reserved block type, a malformed dynamic
  header (invalid code-length alphabet or over-subscribed Huffman tree), or a
  truncated input stream.
- **`deflate.ts`** — RFC 1951 DEFLATE compressor. LZ77 hash-chain length/distance
  match search + fixed-Huffman (type-01) block emission + a stored-block fallback
  when the block-header overhead would exceed the payload. Deferred: dynamic-
  Huffman ENCODE (better ratio; bundled with the PNG-decode phase), lazy matching.
- **`zlib.ts`** — RFC 1950 zlib framing. `zlibCompress(data)` writes a 2-byte
  zlib header + a `deflate`-compressed body + an Adler-32 checksum trailer;
  `zlibDecompress(data)` strips the header, calls `inflate`, and verifies the
  checksum.
- **`pdf-writer.ts`** — the PDF object model. Allocates indirect-object ids,
  writes dictionary and stream objects (compressing each payload via `zlib.ts`
  when compression reduces size — `/Filter /FlateDecode`, `/Length` = compressed
  byte count; `/Length1` preserved as-is), and emits the cross-reference table +
  trailer on `finish(rootId)`. Knows nothing about layout. Guards against
  allocated-but-unwritten ids, duplicate writes, and non-Latin1 bytes. Exports
  `pdfString` — the PDF literal-string escaper (used for the `/Link` annotation's
  `/URI` action string) — and `pdfTextString`, the PDF text-string helper that emits
  a Latin-1 literal string when every code unit fits in one byte, otherwise a
  UTF-16BE hex string with the U+FEFF byte-order mark (used for `/Outlines` `/Title`
  values, which may carry non-Latin-1 / CJK headings).
- **`coordinate.ts`** — the engine→PDF coordinate transform. Engine space is
  y-down, top-left origin, CSS pixels (1/96 in); PDF space is y-up,
  bottom-left origin, points (1/72 in). The transform flips y per-coordinate
  and scales by `PX_TO_PT = 72/96 = 0.75`. There is no CTM flip (a global flip
  would mirror glyphs); each point and rectangle is converted individually.
  `mediaBoxOf(w, h)` derives a page's MediaBox from `PageBox` dimensions.
- **`color.ts`** — a CSS color string → PDF `rg` parser. Handles `#hex`
  (3/6-digit), `rgb()`/`rgba()` (alpha flattened to opaque), named colors, and
  `transparent` (→ skip). Unrecognized input falls back to black.
- **`content-stream.ts`** — a typed graphics + text operator builder for one
  page's content stream. Emits fill color (`rg`), self-contained text-show
  blocks (`BT … Tf … Td … Tj … ET`), filled rects (`rg`+`re`+`f`), and filled
  circles (the 4-cubic-Bézier circle approximation, `m`+4×`c`+`f`), and image
  XObject placements (`drawImageXObject`: `q <cm> cm /Im<n> Do Q`) — each
  independently positioned and colored.
- **`winansi.ts`** — WinAnsiEncoding (Windows-1252). One byte per character for
  the standard-14 fonts: 1:1 for ASCII + Latin-1, plus the printable
  0x80–0x9F smart-typography block (curly quotes, en/em dashes, ellipsis,
  bullet, …) that word processors substitute on nearly every line. Anything
  outside coverage maps to `?` and is counted as dropped (full coverage is the
  phase (c) embedded path).
- **`font-provider.ts`** — the injected font capability. `PdfFontProvider`
  resolves a `ComputedStyle` to a font handle (`resolveFont`), encodes a run into
  display clusters + bytes (`encodeRun`), and **writes its own font objects**
  (`writeFontObjects(usedHandles, writer)` → a `handle → objectId` map). A
  `PdfFontHandle` carries `{ kind: "standard14" | "embedded"; baseFont; fontKey }`
  — `fontKey` is the per-PROGRAM dedup identity (read as a field; the emitter
  resource-names and de-dupes by it). The default `createStandard14FontProvider()`
  maps weight/style/family onto the standard-14 matrix and writes a simple Type1
  object per handle; its `fontKey` equals `baseFont`. `createEmbeddedFontProvider`
  (below) is the real embedded provider; the mock embedded provider (test-only,
  not on the barrel) writes the same composite graph for unit tests. The capability
  injection mirrors how `core` injects `TextShaper` / `Hyphenator` / `ImageCache`,
  keeping HarfBuzz-style font machinery out of the engine.
- **`composite-font.ts`** — `writeCompositeFontObjects(data, writer)`: the shared
  writer for the Type0 / CIDFont / embedded-program / `FontDescriptor` / `ToUnicode`
  object graph (see "Embedded composite-font model" below). It BRANCHES on the
  embed kind: a `glyf` font writes a `FontFile2` + a CIDFontType2 descendant
  (`/CIDToGIDMap /Identity`, Identity ROS); a `cff` font writes a `FontFile3`
  (`/Subtype /CIDFontType0C`) + a CIDFontType0 descendant (no `/CIDToGIDMap`, the
  font's own ROS in `/CIDSystemInfo`). Both the real embedded provider and the mock
  embedded provider assemble a `CompositeFontData` (`baseFont`, the `embed`
  discriminant carrying the program bytes, `descriptor`, per-CID `widths`,
  `defaultWidth`, `cidToUnicode`) and delegate here, so they write a byte-identical
  graph.
- **`cff-parser.ts`** — a mini parser for the `CFF ` table (Adobe TN#5176).
  `parseCff` reads the INDEX structures, the Top-DICT, the String-INDEX, and the
  charset to detect a CID-keyed font, build the GID→CID map, and resolve the ROS
  (`Registry` / `Ordering` / `Supplement`) for the CFF embed's `/CIDSystemInfo`. It
  does NOT touch the charstrings — charstring selection/rebuild is `subset-cff.ts`'s
  job (the `FontFile3` program is the SUBSET `CFF ` table).
- **`sfnt-assembler.ts`** — a production sfnt table-directory writer. `assembleSfnt`
  takes a sfnt version + a set of `SfntTableOut` payloads and emits a well-formed
  sfnt (table directory with correct `searchRange`/`entrySelector`/`rangeShift`,
  4-byte-aligned table data; per-table checksums are written 0 — PDF viewers do not
  validate them, and a copied `head` body's `checkSumAdjustment` is left as-is). The
  `glyf` subset path reassembles the font through it.
- **`subset-glyf.ts`** — `subsetGlyf`: `glyf`/`loca` subsetting with a transitive
  composite-glyph closure (`computeGlyfClosure` follows composite-component
  references so a used composite keeps its component outlines). Keeps the used +
  referenced outlines, zeroes the rest, and reassembles the sfnt via
  `sfnt-assembler.ts`. GID numbering is preserved.
- **`subset-cff.ts`** — CFF subsetting. Decodes the DICTs (`decodeDict`), locates the
  table's structures (`locateCffStructures` — INDEXes, charset, encoding, FDSelect,
  Private), rebuilds the CharStrings INDEX (`rebuildCharStrings`: used charstrings
  verbatim, each unused → a single `endchar`), and re-emits the whole `CFF ` table
  (`subsetCff`) in canonical layout with fixed-width offset operands, copying the
  non-CharStrings structures verbatim at recomputed positions and preserving real
  DICT operands (FontMatrix, etc.) byte-for-byte. GID/CID numbering is preserved.
- **`subset-font.ts`** — `subsetFont(parsed, usedGids)`: the dispatcher. Routes by
  `glyphFormat` to `subsetGlyf` (sfnt) or `subsetCff` (the `CFF ` table), returning
  the subset program bytes. `subsetTag(usedGids)` derives the deterministic
  6-uppercase-letter subset tag from the used-GID set.
- **`truetype-parser.ts`** — a pure-byte sfnt reader for BOTH `glyf` TrueType
  (sfnt version `0x00010000`) and CFF-flavored OpenType (`OTTO`).
  `parseSfnt(bytes)` reads the table directory + `head` / `hhea` / `maxp` /
  `hmtx` (with the hmtx tail-repeat rule) / `cmap` (formats 4 + 12, Unicode
  subtable preference `(3,10)→(3,1)→(0,*)`) / `OS-2` / `post` / `name` — the shared
  path for both flavours — and exposes `cmapLookup(cp)→gid`, `advanceOf(gid)`, a
  1000-em `FontDescriptor` (OS/2 version-guarded fields; USE_TYPO_METRICS honored on
  OS/2 v≥2; PDF flags from macStyle / post.isFixedPitch / usWeightClass), a
  `glyphFormat: "glyf" | "cff"` discriminant, and (for `OTTO`) a `cff: CffInfo`
  parsed via `cff-parser.ts`. Throws `MalformedFontError` on a
  truncated/overrunning font.
- **`embedded-font-provider.ts`** — `createEmbeddedFontProvider({ fonts, fallback? })`:
  the real embedded `PdfFontProvider`. Parses each supplied font once (`.ttf` or
  `.otf`); resolves a known `fontFamily` to an `embedded` handle (else delegates to
  the std-14 fallback); `encodeRun` emits the 2-byte big-endian **emitted code**
  (`Identity-H`) — the CID, which for a CID-keyed CFF is the charset's GID→CID
  mapping, else the GID (CID === GID) — and records the used code→unicode per family;
  `writeFontObjects` SUBSETS the program — it calls `subsetFont(parsed, usedGids)`
  (where `usedGids` is the document's used GIDs plus GID 0 `.notdef`) and `subsetTag`,
  then assembles `CompositeFontData` (the `glyf`/`cff` embed discriminant + the SUBSET
  program bytes; the `subsetTag`-prefixed `/BaseFont` + `/FontName`; widths over the
  USED codes only, scaled to 1000-em) and delegates to `writeCompositeFontObjects`.
  Exported from the barrel — hosts inject it.
- **`image-provider.ts`** — the injected image capability (peer of the font
  provider). `PdfImageProvider` resolves a layout image `src` to a `PdfImageHandle`
  (`resolveImage`, or `null` when unresolvable → grey placeholder) and **writes its
  own Image XObject stream objects** (`writeImageObjects(used, writer)` → a
  `handle → objectId` map). `PdfImageHandle` is the minimal `{ imageKey }` —
  providers carry rich data privately in a `WeakMap<PdfImageHandle, ...>` keyed by
  the handle. Dedup is by `imageKey`. There is NO default provider — consumers must
  inject one; the mock provider is test-only. Mirrors the font-provider seam.
- **`jpeg-parser.ts`** — `parseJpeg(bytes) → JpegImageInfo`. A pure in-package
  JPEG header parser for `/DCTDecode` embedding. Reads the `SOFn` marker
  (`SOF0`/`SOF1`/`SOF2`; rejects arithmetic/lossless/differential SOFs loudly) for
  `width`, `height`, `bitsPerComponent`, and component count → `colorSpace`
  (`DeviceGray`/`DeviceRGB`/`DeviceCMYK`). Detects an Adobe `APP14` (`FFEE`) segment
  (five-byte `"Adobe"` prefix) to set `invertCmyk: true` for 4-component images
  that carry it. Never decodes pixel data — `/DCTDecode` embedding is a verbatim
  passthrough; the PDF renderer does the pixel decode natively. Throws
  `MalformedImageError` (the shared image loud-failure type) on a malformed /
  unsupported-SOF JPEG.
- **`image-errors.ts`** — `MalformedImageError extends Error`, the shared resolve-time
  loud-failure type for image decode (thrown by both `parseJpeg` and `decodePng`).
  Distinct from returning `null` for an absent / unrecognized format: a format we DO
  support but that is malformed or uses a recognized-but-unembeddable variant
  (arithmetic JPEG; 16-bit / interlaced PNG) THROWS.
- **`png-parser.ts`** — `parsePng(bytes) → PngChunks`. Validates the 8-byte signature
  and the 13-byte IHDR, then walks chunks collecting the PLTE / tRNS bytes and the
  CONCATENATED IDAT (a single zlib stream). Loud-rejects (`MalformedImageError`) a bad
  signature, `compressionMethod`/`filterMethod` ≠ 0, interlace = 1, bit depth 16, an
  unknown colorType or a colorType/bitDepth combo not in the PNG table, tRNS present for
  colorType 4/6, a missing PLTE for colorType 3, a truncated chunk, or no IDAT. Does NOT
  verify chunk CRCs (deferred) and does NOT decode pixels (that is `png-decode.ts`).
- **`png-decode.ts`** — `decodePng(bytes) → DecodedPng`. The pixel decoder: `parsePng`,
  then `zlibDecompress` the IDAT (the d.3a inflate), enforce the
  `inflated.length === height*(1+rowBytes)` invariant, reverse the 5 PNG scanline
  filters (None/Sub/Up/Average/Paeth, mod-256, with the `i ≥ bpp` left-stride), and
  resolve the color type to a PDF representation: `DeviceGray` / `DeviceRGB` /
  `{kind:"Indexed", hival, palette}` samples at native `BitsPerComponent`, plus an
  optional 8-bit `DeviceGray` SMask (colorType 4/6 alpha, palette tRNS — sub-byte
  indices unpacked per-row with pad-bit skip, trailing indices opaque) or a
  native-space color-key `/Mask` array (grayscale/RGB tRNS). Returns
  `{ width, height, colorSpace, bitsPerComponent, samples, smask, colorKeyMask }`.
- **`image-provider-impl.ts`** — `createImageProvider({ images })` (exported from
  the package barrel). Host supplies a `Map<src, Uint8Array>` of source file bytes;
  the package parses and embeds in-package (headless, zero-dependency). `resolveImage`
  dispatches by magic bytes: JPEG (`FF D8 FF`) → `parseJpeg`; PNG (`89 50 4E 47`) →
  `decodePng`; both store rich data in a private `WeakMap` and return a minimal
  `PdfImageHandle`. A malformed JPEG/PNG (or a 16-bit/interlaced PNG) THROWS
  `MalformedImageError`; an unknown or absent format returns `null` (grey placeholder).
  A per-`src` cache returns the same result on repeat resolves (success and `null`
  cached; a throwing decode is not cached). `writeImageObjects` emits the Image XObject:
  for JPEG, colorspace + optional `/Decode` + `/Filter /DCTDecode` + verbatim bytes; for
  PNG, the decoded samples as a `/FlateDecode` stream (`writeStream` compresses them)
  with the resolved `/ColorSpace` (incl. `[/Indexed /DeviceRGB hival <hex>]`), a
  separate DeviceGray `/SMask` Image XObject written first when alpha is present, and a
  color-key `/Mask` array when set.
- **`page-emitter.ts`** — the heart. `emitPageContent(page, deps)` walks one
  `PageBox`'s box tree TWICE — a background pass then a foreground pass, mirroring
  the canvas renderer's two `paintBox` invocations — accumulating each box's
  absolute origin from the parent-relative `box.x`/`box.y` + `relativeOffset`. It
  descends `children`, a `MultiColumnBox`'s `columns`, `absoluteChildren`, and
  the page's header / footer / footnote slots. The **background pass** emits box
  backgrounds (`backgroundColor`), per-side borders (via core's
  `physicalBorderSides`), images (the XObject `Do`, or a grey placeholder), and
  horizontal rules — under the content. The **foreground pass** emits every
  text-bearing leaf (`text-run`, `marker`), then its underline / line-through
  decorations, plus tab leaders for inline-block tabs. A text-run carrying a
  `link` whose URL passes `isOpenableLinkUrl` contributes a `{ url, rect }` to the
  page's link rects (`rect` = the `/Rect` `[llx lly urx ury]` from `rectYUp`). The
  foreground pass also accumulates `internalLinkRects` — one `{ targetId, rect }`
  per cross-reference atom (`InlineBlockBox.targetId`) and per TOC entry container
  (`BlockBox.metadata.navTarget`, whole-line click); a cross-ref atom nested inside
  a TOC entry container is de-duped out (the whole-line link wins, tracked via an
  `insideTocEntry` walk flag). Resolution of each `targetId` to a concrete page +
  coordinates is deferred to `emit-pdf` (which holds the injected resolver).
  Returns the page's content bytes, the font handles it used (`usedHandles`,
  deduped by `fontKey`), the image handles it placed (`usedImages`, deduped by
  `imageKey`) — both in first-encountered order — `linkRects` (empty when the
  page has no live external links), and `internalLinkRects` (empty when the page
  has no cross-ref / TOC internal links).
- **`tounicode.ts`** — `buildToUnicodeCMap(cid → unicode)`: a valid
  Adobe-Identity-UCS `ToUnicode` CMap (codespacerange + chunked
  `beginbfchar`/`endbfchar` blocks, ≤100 entries each) making embedded text
  searchable/copyable. Destination Unicode is UTF-16BE over JS string CODE UNITS,
  so an astral scalar emits a surrogate pair (`<D83DDE00>`), not the 4-byte UCS-4
  form a reader would reject.
- **`emit-pdf.ts`** — orchestration. `emitPdf({ pageCount, getPage, fontProvider?,
  imageProvider?, resolveInternalDestination?, outline?, structureTree?, lang? })` streams pages via `getPage(i)`,
  de-dupes fonts by `fontKey`
  into a `usedHandleByKey` map (one stable `/Fn` name per distinct font program)
  and images by `imageKey` into a `usedImageByKey` map (one `/Im<n>` name per
  distinct image), delegates all font-object writing to `provider.writeFontObjects`
  and all image-object writing to `imageProvider.writeImageObjects`. It
  PRE-ALLOCATES every page object id before the per-page write loop (so a page's
  internal `/GoTo` annotation can forward-reference a later page's object id — a
  legal PDF indirect ref), then writes the
  per-page content stream + page object (MediaBox / Resources / Contents — the
  `/Resources` carries `/Font` always and `/XObject` only when the page set uses
  images, so image-free output is byte-identical), the Pages tree, and the Catalog.
  For each page it merges TWO annotation kinds into one `/Annots` array: one
  `/Link` `/A << … /S /URI /URI (…) >>` per `linkRect` (external hyperlinks, the
  `/URI` escaped via `pdfString`; a URL with a code unit above Latin-1 is gracefully
  skipped), and — when `resolveInternalDestination` is injected — one `/Link`
  `/A << … /S /GoTo /D [<targetPageObjId> 0 R /XYZ left top 0] >>` per
  `internalLinkRect` whose `targetId` the closure resolves to a concrete
  `{ pageIndex, yTopPx, xLeftPx }` (a broken/unresolved target → `null` → no annot).
  A page with zero annotations omits `/Annots` and stays byte-identical. See
  [the Annotations section](#link-annotations). When an `outline` (a
  `PdfOutlineNode[]`) is supplied, it emits the `/Outlines` bookmark tree:
  PRE-ALLOCATES one object id per outline item in a first depth-first pass (so each
  item dict can name its `/Parent`/`/Prev`/`/Next`/`/First`/`/Last` siblings), then
  writes the `/Outlines` root dict (`/Type /Outlines`) plus one item dict per node —
  `/Title` via `pdfTextString`, `/Dest [<pageObj> 0 R /XYZ left top 0]` via
  `pointYUp` over each node's resolved destination, the doubly-linked
  `/Prev`/`/Next` chain, and `/First`/`/Last`/positive-`/Count` when the node has
  children — and links `/Outlines` from the Catalog. An empty `outline` (or none)
  emits no `/Outlines` and stays byte-identical. See
  [the Outline / bookmarks section](#outline--bookmarks). The entry point exported
  from the barrel.

## Text-placement model

Text is placed **absolutely, per display cluster** — not as a single
left-anchored run with relative advances. For each text/marker leaf:

- The alphabetic baseline in engine coordinates is
  `boxTop + halfLeading + fontSize`, where
  `halfLeading = (box.height − fontSize) / 2` — the same baseline geometry the
  canvas renderer uses.
- Each display cluster's left edge is the prefix sum of the leaf's
  `clusterWidths` (the engine's own measured advances). For a right-to-left run
  (odd `bidiLevel`) clusters are placed from the box's right edge inward. When
  `clusterWidths` is absent the emitter falls back to an even split of the box
  width and logs it (no silent degradation).
- Each cluster origin is converted to PDF space via `pointYUp`, then shown with
  its own `Td` + `Tj`.

The font provider owns encoding (the show bytes — one WinAnsi byte per character
for standard-14, two `Identity-H` CID bytes per glyph for embedded — plus the
`ToUnicode` map); the layout owns positioning. The two never overlap — the
page-emitter receives an injected `fontResourceName(fontKey)`, passes the
provider's `cluster.bytes` to the content stream verbatim (`content-stream.ts`
hex-encodes them, so the 1-byte vs 2-byte distinction needs no special-casing),
and never invents PDF object structure. **Embedding changes glyph SELECTION only,
never geometry**: a run's per-cluster `Td` origins are identical whether it
resolves to a standard-14 or an embedded font.

## Embedded composite-font model

An embedded font is written as a **Type0 composite font with a CIDFont
descendant** — the standard way to embed an outline program with full Unicode
coverage (PDF §9.7 / ISO 32000-1 §9.7.4.2). The descendant flavour BRANCHES on the
outline format; the provider's `writeFontObjects` emits, per embedded handle:

- the **embedded program stream**, format-dependent and always the SUBSET (only the
  used glyphs' outlines, see "Phase boundary" (c.3)):
  - `glyf` → a **`FontFile2`** stream (the subset TrueType sfnt bytes, `/Length1` =
    the uncompressed program length);
  - `cff` → a **`FontFile3`** stream (`/Subtype /CIDFontType0C`, the subset `CFF `
    table bytes);
- a **`FontDescriptor`** — `/Flags`, `/FontBBox`, `/ItalicAngle`, `/Ascent`,
  `/Descent`, `/CapHeight`, `/StemV`, `/FontName` (carrying the `XXXXXX+` subset
  tag, matching the Type0 `/BaseFont`), and `/FontFile2` (glyf) or `/FontFile3` (cff)
  (metrics in 1000-unit em space, font-native — independent of the px→pt geometry
  scale);
- a **CIDFont descendant**, format-dependent:
  - `glyf` → a **CIDFontType2** — `/CIDToGIDMap /Identity`, an Identity
    `/CIDSystemInfo` (`Adobe` / `Identity` / `0`), `/DW` default width + a `/W`
    per-CID width array;
  - `cff` → a **CIDFontType0** — NO `/CIDToGIDMap` (the CFF charset owns GID↔CID),
    a `/CIDSystemInfo` carrying the **font's own ROS** (`Registry` / `Ordering` /
    `Supplement`, from `cff-parser.ts`), `/DW` + `/W`;
- a **`ToUnicode`** CMap (`tounicode.ts`) for text extraction;
- the **Type0** root — `/Encoding /Identity-H`, `/DescendantFonts`, `/ToUnicode`.

Glyph selection emits **2-byte big-endian codes** (`Identity-H`); the code is the
**CID**. For a `glyf` font and a non-CID-keyed CFF the CID equals the GID; for a
CID-keyed CFF (common CJK `.otf`) the CFF charset maps GID→CID and that CID is
emitted. The `/W` widths and the `ToUnicode` CMap are keyed by the same emitted
code. De-duplication is keyed on `fontKey` (the font program identity), NOT
`baseFont`: two fonts that happen to share a base-font name but carry different
programs get distinct Type0 objects and distinct program streams. The c.1 machinery
is shared by `composite-font.ts`'s `writeCompositeFontObjects`; in **c.2a/c.2b**
`createEmbeddedFontProvider` supplies real program bytes + metrics (cmap / hmtx /
descriptor, plus the CFF charset/ROS for `OTTO`) parsed from a `.ttf`/`.otf`, while
the mock provider still drives the unit tests. Glyph subsetting (c.3) is applied
before this writer runs: the embedded program is the subset (only the used glyphs'
outlines, GID/CID numbering preserved), and a 6-letter subset tag prefixes
`/BaseFont` + `/FontName`.

## Graphics model

All box decoration the canvas renderer paints is reproduced as **filled shapes**
— no strokes. The page-emitter's two passes mirror the renderer's
background/foreground phase split:

- **Background pass** (under content): a box's `backgroundColor` fill, its four
  physical border sides (mapped from logical via core's `physicalBorderSides`,
  each a filled edge rect), images (the Image XObject `Do`, or a grey placeholder
  rect), and horizontal rules — painted in that order (bg → borders → image → HR,
  matching the canvas renderer) so all sit under content.
- **Foreground pass** (over glyphs): a text-run's underline / line-through (thin
  rects at the renderer's exact baseline-relative y), and tab leaders for
  inline-block tabs — solid/dashed leaders as filled rects, dotted leaders as
  filled circles.

Every rect/circle is in engine coordinates and converted per-shape via `rectYUp`
/ `pointYUp` (a circle's radius scales by `PX_TO_PT`); colors parse through
`color.ts`. Geometry (border-side rects, decoration y-offsets, leader spacing,
the dot-circle approximation) is byte-faithful to `canvas-renderer.ts`.

**v1 boundaries (documented, not silent):** stacking is **document order** —
`z-index` reordering is deferred; inline-box border-edge suppression on
soft-wrap fragments is not yet applied (all four sides emit); `rgba()` alpha is
flattened to opaque.

## Link annotations

Document hyperlinks export as clickable `/Link` annotations (ISO 32000-1
§12.5.6.5). The mechanism is a thread + a per-page annotation write — orthogonal
to the content-stream graphics above:

- **Thread.** A run's source hyperlink URL (the inline `link` attr) rides on the
  layout text run as `TextRunBox.link` — per-run identity metadata, OPAQUE to
  geometry, threaded render `TextBox.link` → IFC `Token.link` → `TextRunBox.link`
  and copied through every reorder / hyphen-split / bidi-split rebuild. It is the
  RAW URL, carried in parallel to the cascade's `linkInterpreter` visual styling
  (the link color + underline); the two are independent.
- **Collect.** The page-emitter's foreground walk emits one `{ url, rect }` per
  laid-out text-run whose `link` passes core's `isOpenableLinkUrl` (an explicit
  safe scheme — `http`/`https`/`mailto`/`tel`; relative/non-safe URLs are dropped,
  matching what a reader could navigate). `rect` is the PDF `/Rect`
  `[llx lly urx ury]` from `rectYUp`. This covers body + header / footer / footnote
  slots (the same box walk). One annotation per run / line-fragment: a hyperlink
  wrapped across lines yields one `/Link` per visual fragment, the standard
  approach (Acrobat / Word do the same).
- **Emit.** `emit-pdf` writes one `/Link` annotation object per collected rect
  (`/Subtype /Link`, `/Rect`, `/Border [0 0 0]` for no visible frame, and an
  `/A << /Type /Action /S /URI /URI (…) >>` URI action — the URL escaped through
  `pdfString`) and appends `/Annots` to the `/Page` dict ONLY when the page carries
  ≥1 link, so a link-free page stays byte-identical. A URL whose bytes exceed
  Latin-1 (>0xFF) is gracefully skipped (no annotation, no crash).

`isOpenableLinkUrl` (and its sibling `isExportSafeLinkUrl`, used by HTML export)
live in `@taleweaver/core` (`url-safety.ts`, on the core barrel), shared by
`@taleweaver/print` and `@taleweaver/pdf` — so `pdf` consumes the predicate without
a `print` dependency. Autolink is out (the engine has no autolink).

**Internal `/GoTo` links** (cross-ref / TOC jump-to-page) ride the SAME `/Annots`
array via a separate collect + emit path. The page-emitter's foreground walk
collects one `{ targetId, rect }` per cross-ref atom (`InlineBlockBox.targetId`)
or TOC entry container (`BlockBox.metadata.navTarget`, whole-line link; a cross-ref
atom nested inside a TOC entry is de-duped out). `emit-pdf` resolves each `targetId`
to a `{ pageIndex, yTopPx, xLeftPx }` destination via the injected
`EmitPdfInput.resolveInternalDestination` closure, then writes a `/Link` whose
action is `/A << /Type /Action /S /GoTo /D [<targetPageObj> 0 R /XYZ x y 0] >>`
(the destination point via `pointYUp`). A broken target (resolver returns `null`)
or an absent resolver yields no annot. Because a page-1 link can point at a later
page, every page object id is PRE-ALLOCATED before the per-page write loop so the
`/D` array can carry a legal forward indirect reference.

## Outline / bookmarks

The document heading hierarchy exports as a clickable `/Outlines` bookmark tree
(ISO 32000-1 §12.3.3) — a reader's navigation pane jumps to each heading's exact
position. The path is end-to-end:

- **Build (core).** `buildPdfOutline` (`@taleweaver/core`,
  `layout/pdf-outline.ts`) reads the document headings via `getOutline` in the
  ACCEPTED (`"final"`) suggestion view — an exported PDF represents the accepted
  document, matching the view its pages were laid out from. It NESTS the flat
  heading list by heading level (a stack walk; a level skip — e.g. an H1 directly
  followed by an H3 — attaches the deeper heading to the nearest strictly-shallower
  ancestor, not a synthetic intermediate), and resolves each heading's jump
  destination via the same `resolveGotoDestination` machinery the `/GoTo` links use.
  The result is a `PdfOutlineNode[]` — each node a `{ title, dest, children }` where
  `dest` is the resolved `{ pageIndex, yTopPx, xLeftPx }` (or `null` for a heading
  whose position does not resolve). A heading-free document yields `[]`.
- **Emit (pdf).** `emit-pdf` takes the tree as `EmitPdfInput.outline` and emits the
  `/Outlines` root dict (`/Type /Outlines` + `/First`/`/Last`/`/Count`) plus one
  item dict per node. A first depth-first pass PRE-ALLOCATES every item's object id,
  so each item can name its `/Parent`, its doubly-linked `/Prev`/`/Next` siblings,
  and (when it has children) `/First`/`/Last` + a POSITIVE `/Count`. Each item's
  `/Title` is encoded via `pdfTextString` (UTF-16BE for non-Latin-1 / CJK headings)
  and its `/Dest [<pageObj> 0 R /XYZ left top 0]` is built from the node's resolved
  destination via `pointYUp`, reusing the page-object-id pre-allocation the `/GoTo`
  links rely on. The Catalog gains an `/Outlines` reference. All items are emitted
  OPEN (positive `/Count`s) — there is no collapsed-bookmark source state. An empty
  (or absent) `outline` emits no `/Outlines` and stays byte-identical.

The app-facing PDF-export surface is `EditorController.exportToPdf(emit)` in
`@taleweaver/print`. It composes a PDF-type-free `PrintPdfEmitInput` from the live
document as a pure query — pages from `virtualTree.getPage`, the internal-link
resolver from `makeInternalDestinationResolver`, the bookmark tree from
`buildPdfOutline`, the raw `accessibilityTree` from `buildAccessibilityTree` — and
hands it to the injected `emit`, returning the PDF **bytes**. The standard emitter is
`createPdfEmitter({ fontProvider?, imageProvider? })` (this package), which maps the
accessibility tree and threads the providers into `emitPdf`. Font / image program
bytes are an injection seam; absent them, text uses the standard-14 fonts and images
render as grey placeholders. Triggering a browser download (Blob + anchor), a default
`fontProvider` derived from the document's loaded fonts, and export of non-paginated
(float/clear) documents remain deferred follow-ons; `exportToPdf` throws for the
float/clear case. See `docs/architecture/2-print/2.8-editor-controller.md`.

## Image model

A layout image box (a `block` `ElementBox` carrying `metadata.image = { src,
width, height }`) is emitted in the BACKGROUND pass via the injected
`PdfImageProvider`:

- **Resolve.** `imageProvider.resolveImage(src)` yields a `PdfImageHandle`
  (`{ imageKey }` — providers carry rich data privately in a `WeakMap`) or `null`.
  A null (no provider, an unresolvable `src`, or an unrecognized format) draws a grey
  `#f0f0f0` placeholder rect at the box geometry — mirroring the canvas renderer's
  not-cached branch, so a missing image is a visible placeholder, never a silent void.
  A recognized-but-malformed image of a SUPPORTED format (a corrupt JPEG/PNG, or a
  16-bit/interlaced PNG) instead throws `MalformedImageError` at resolve time — loud,
  not a silent mis-embed.
- **Object graph.** `writeImageObjects` writes one **Image XObject** stream per
  distinct `imageKey` (plus, for a PNG with alpha, a separate DeviceGray `/SMask`
  Image XObject referenced by the main image — NOT a page resource, so it stays out of
  `/Resources /XObject`). The dict carries `/Type /XObject /Subtype /Image /Width W
  /Height H /BitsPerComponent B`; the `/ColorSpace` / `/BitsPerComponent` / `/Filter`
  are provider-determined:
  - **JPEG** → `/ColorSpace` from `parseJpeg` (`DeviceGray`/`DeviceRGB`/`DeviceCMYK`),
    `/Filter /DCTDecode` (+ optional `/Decode` for inverted Adobe CMYK), JPEG bytes
    embedded verbatim.
  - **PNG** → decoded samples as a `/FlateDecode` stream (`writeStream` compresses
    them) at native `/BitsPerComponent` (1/2/4/8), `/ColorSpace` `DeviceGray` /
    `DeviceRGB` / `[/Indexed /DeviceRGB hival <hexPalette>]`, plus `/SMask <id> 0 R`
    (alpha) or `/Mask [..]` (color-key tRNS) as decoded.
  - the d.1 mock provider uses a hardcoded `/ColorSpace /DeviceRGB` with unfiltered
    raw RGB samples.
  `/Length` is injected by `writeStream`. The objects are allocated before the page
  tree (like fonts); the per-page `/Resources /XObject << /Im<n> … >>` references the
  main image handles.
- **Placement.** The content stream places the image with `q <cm> cm /Im<n> Do Q`,
  where `cm = [wPt, 0, 0, hPt, xPt, yBottomPt]` from
  `rectYUp(absX, absY, img.width, img.height, pageHeightPx)`. The cm uses the
  **display** dims (`metadata.image.width`/`height`, matching the canvas
  `drawImage`); the XObject `/Width`/`/Height` use the handle's **intrinsic**
  sample dims. PDF samples row 0 at the top of the unit square, so the positive
  `hPt` scale renders the image **upright** with no y-flip.

JPEG images embedded via `/DCTDecode` are live (d.3b-1): the PDF renderer decodes
the JPEG natively, so the package only needs to parse the header (dims/colorspace/
Adobe-CMYK flag) and pass the raw bytes through. PNG is live (d.3b-2): decoded
in-package (`png-parser.ts` → `png-decode.ts`) and re-embedded as a `/FlateDecode`
Image XObject, with alpha → `/SMask` and grayscale/RGB tRNS → color-key `/Mask`.
16-bit-depth and interlaced PNG, PNG CRC verification, and color spaces beyond
`DeviceGray`/`DeviceRGB`/`DeviceCMYK`/`/Indexed` are deferred refinements
(16-bit/interlaced PNG loud-reject; an unrecognized format draws the grey
placeholder). d.1 is the mock-tested XObject machinery; d.2 is the transparent stream
compression (applied to all stream objects whose dict carries no `/Filter`, including
the PNG image + SMask samples).

## Relationship to the rest of the engine

See [`../overview.md`](../overview.md) for how `pdf` sits among the packages,
and [`../2-print/2.5-canvas-renderer.md`](../2-print/2.5-canvas-renderer.md) for the
canvas renderer whose box-tree walk and baseline math the PDF emitter mirrors.
Implementation status is tracked in
[`../state-of-branch.md`](../state-of-branch.md).
