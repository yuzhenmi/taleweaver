/**
 * Single-user commands as Plans (r7 §5, with review-r7 G1, G4–G6, G8 applied), one per
 * file in `commands/` (shared machinery in `commands/helpers/`): text, Enter, Backspace /
 * Delete, range delete, marks, paragraph attrs; and (r7 §5 + review-r7 G1, G6) inline
 * objects (C11 / C12), the horizontal rule (C13), TOC (C14) and block-object delete
 * (C10), section breaks (C15), footnotes (S1), headers / footers (S2), generic markers,
 * paste (C17).
 *
 * Every command reads ONE version and returns a {@link Plan} (or null: nothing to
 * do); it throws only on invalid arguments. Commands keep W1 (text is ¶-terminated)
 * and W2 (a block object is followed by a ¶-paragraph); they write only the edited
 * paragraphs and the items they create or delete.
 *
 * Shared rules:
 *   - JOIN (C3, C7, C8, C9): when a ¶ between two paragraphs is deleted, the
 *     surviving ¶ (the later paragraph's) takes the FIRST paragraph's `p:*` / `m:*`
 *     (G8, Google Docs) — unless the first is left an EMPTY DEFAULT paragraph (no
 *     text kept, plain type, no attrs): then the survivor keeps its own (today's
 *     `joinWithNext`). `t:*` tags are never moved.
 *   - X2: a command that needs a debris paragraph's ¶ first inserts that ¶.
 *   - Deletions never remove inert storage at a range's edges (`pointBefore` /
 *     `pointAfter`), and never remove a flow container or sub-flow item.
 */
import type { Document } from "../document/types";
import type { ModelSelection } from "../position/model-position";
import type { PositionOptions } from "../position/resolve-position";

export interface CommandOptions extends PositionOptions {
  /** Typing at a mark's edge extends it (default: every mark; atomic marks never). */
  readonly isInclusiveMark?: (key: string) => boolean;
  /** C2 next-style: the type a paragraph split at its END gives the new paragraph (default: heading → paragraph). */
  readonly nextStyle?: (type: string) => string | undefined;
  /** Paragraph attrs that belong to one paragraph and are never copied by a split (default: `listCounterOverride`). */
  readonly oneShotAttrs?: ReadonlySet<string>;
}

export interface CommandContext {
  readonly version: Document;
  readonly selection: ModelSelection;
  readonly options?: CommandOptions;
}
