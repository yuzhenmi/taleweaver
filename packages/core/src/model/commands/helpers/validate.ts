import { resolveObjectProps } from "../../object-kinds";
import type { ObjectProps } from "../../storage/new-items";
import { type FlatKeys, type Scalar, isWriteScalar } from "../../storage/scalar";
import type { CommandContext } from "../command-context";
import { type Keys, scalar } from "./paragraph-keys";

export function checkScalars(attrs: Readonly<Record<string, unknown>>, what: string): Record<string, Scalar> {
  const out: Record<string, Scalar> = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "") throw new Error(`model: ${what} with an empty key`);
    const s = scalar(v);
    if (s === undefined || !isWriteScalar(v)) throw new Error(`model: ${what} ${k} must be null, a string, a finite number or a boolean`);
    out[k] = s;
  }
  return out;
}

export function checkKeys(keys: FlatKeys, prefixes: readonly string[], what: string): Keys {
  const out: Keys = {};
  for (const [k, v] of Object.entries(keys)) {
    if (!prefixes.some((p) => k.startsWith(p) && k.length > p.length)) throw new Error(`model: ${what} key ${k} is not ${prefixes.join(" / ")}`);
    if (!isWriteScalar(v)) throw new Error(`model: ${what} key ${k} must be null, a string, a finite number or a boolean`);
    out[k] = v;
  }
  return out;
}

export function validObject(ctx: CommandContext, kind: string, o: ObjectProps): void {
  const props: Record<string, unknown> = checkScalars(o.props ?? {}, "object prop");
  if (resolveObjectProps(ctx.version.registry, kind, props) === null) throw new Error(`model: object kind ${kind} is unregistered or misses a required prop`);
  for (const n of [o.w, o.h]) if (n !== undefined && !(Number.isFinite(n) && n >= 0)) throw new Error("model: object size must be a finite number ≥ 0");
}
