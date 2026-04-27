import type { Style } from "./style";

/**
 * Resolved style — every property is required and lengths are absolute px.
 * Produced by the cascade pass.
 */
export type ComputedStyle = Required<Style>;
