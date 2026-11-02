import type { InlineItem } from "../block";
import { resolveObjectProps } from "../object-kinds";
import type { Plan } from "../plan";
import type { ModelPosition } from "../position/model-position";
import { paragraphLayout } from "../position/paragraph-layout";
import { pointBefore } from "../position/storage-points";
import { ITEM_KINDS } from "../storage/keys";
import { kindOf } from "../storage/map-reads";
import { type Scalar, isWriteScalar } from "../storage/scalar";
import type { CommandContext } from "./command-context";
import { plan } from "./helpers/build-plan";
import { mapAtIndex } from "./helpers/map-at-index";
import { keysWrite } from "./helpers/writes";

export interface ObjectPropsPatch {
  /** null = inline (deletes `wrap`). */
  readonly wrap?: "left" | "right" | "break" | null;
  readonly w?: number | null;
  readonly h?: number | null;
  /** Kind props (`a:*`); null deletes. */
  readonly props?: Readonly<Record<string, Scalar>>;
}

/** C12: write wrap / size / kind props on the object whose unit starts at `at`. */
export function setObjectProps(ctx: CommandContext, at: ModelPosition, patch: ObjectPropsPatch): Plan | null {
  const L = paragraphLayout(ctx.version, at.blockId);
  const item = L === null ? null : embedAt(L.block.inlineContent?.items ?? [], at.offset);
  if (L === null || item === null || item.kind !== "embed" || item.embedType !== "object") return null;
  const p = pointBefore(L, at.offset);
  const map = p === null ? null : mapAtIndex(p.piece, p.index);
  if (map === null || kindOf(map) !== ITEM_KINDS.object) return null;
  const keys: Record<string, Scalar | undefined> = {};
  if (patch.wrap !== undefined) {
    if (patch.wrap !== null && !["left", "right", "break"].includes(patch.wrap)) throw new Error("model: wrap must be left / right / break / null");
    keys["wrap"] = patch.wrap ?? undefined;
  }
  for (const [k, v] of [["w", patch.w], ["h", patch.h]] as const) {
    if (v === undefined) continue;
    if (v !== null && !(Number.isFinite(v) && v >= 0)) throw new Error("model: object size must be a finite number ≥ 0");
    keys[k] = v ?? undefined;
  }
  for (const [k, v] of Object.entries(patch.props ?? {})) {
    if (k === "") throw new Error("model: object prop with an empty key");
    if (!isWriteScalar(v)) throw new Error(`model: object prop ${k} must be null, a string, a finite number or a boolean`);
    keys[`a:${k}`] = v ?? undefined;
  }
  // A patch may not turn a valid object into a placeholder (removing / retyping a required prop);
  // an object that already reads as a placeholder can still be patched.
  const stored: Record<string, unknown> = {};
  map.forEach((v, k) => {
    if (k.startsWith("a:")) stored[k.slice(2)] = v;
  });
  const patched: Record<string, unknown> = { ...stored };
  for (const [k, v] of Object.entries(keys)) if (k.startsWith("a:")) patched[k.slice(2)] = v;
  const kind = map.get("kind");
  const reg = ctx.version.registry;
  if (typeof kind === "string" && resolveObjectProps(reg, kind, stored) !== null && resolveObjectProps(reg, kind, patched) === null) {
    throw new Error("model: the patch removes or retypes a required object prop");
  }
  const writes = keysWrite(map, keys);
  if (writes.length === 0) return null;
  const sel = ctx.selection;
  return plan(ctx.version, writes, () => sel);
}

/** The embed whose unit starts at `offset`, or null. */
function embedAt(items: readonly InlineItem[], offset: number): InlineItem | null {
  let pos = 0;
  for (const i of items) {
    const n = i.kind === "text" ? i.text.length : 1;
    if (offset === pos && i.kind === "embed") return i;
    if (offset < pos + n) return null;
    pos += n;
  }
  return null;
}
