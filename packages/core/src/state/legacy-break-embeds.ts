/**
 * The schema ≤ 2 inline embed types of a pending paragraph-break suggestion. Schema 3
 * stores break suggestions as mark tags (`break-tags.ts`); these names exist only for
 * the upgrade (which converts them) and the dev storage check (which rejects them).
 * Not exported from the package.
 */
export const LEGACY_BREAK_SPLIT_EMBED_TYPE = "block-split-suggestion";
export const LEGACY_BREAK_JOIN_EMBED_TYPE = "block-join-suggestion";

export function isLegacyBreakEmbedType(embedType: string): boolean {
  return embedType === LEGACY_BREAK_SPLIT_EMBED_TYPE || embedType === LEGACY_BREAK_JOIN_EMBED_TYPE;
}
