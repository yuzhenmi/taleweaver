export type Scalar = string | number | boolean | null;
/** Flat, already-prefixed scalar keys (`p:type`, `m:bold`, `s:pageInlineSize`, `a:src`, …). */
export type FlatKeys = Readonly<Record<string, Scalar>>;

/**
 * A value a command may WRITE as a flat key or formatting value: null, a string, a
 * finite number or a boolean (never a function, symbol, bigint, undefined or NaN).
 */
export const isWriteScalar = (v: unknown): v is Scalar =>
  v === null || typeof v === "string" || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v));

/** A Yjs scalar (null or a non-object): the only values the read takes from flat keys. */
export const isScalar = (v: unknown): boolean => v === null || typeof v !== "object";
