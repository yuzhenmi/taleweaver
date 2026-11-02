import * as Y from "yjs";

// ---------------------------------------------------------------------------
// Deep clone of shared types (`Y.Text.clone()` does not copy embedded types deeply)
// ---------------------------------------------------------------------------

/**
 * A detached copy of `t`: maps, arrays and texts recursively, live content only, text
 * formatting kept. Used to copy content between flows (T6 merge, P2 M4).
 */
export function deepClone(t: Y.Text): Y.Text;
export function deepClone(t: Y.Map<unknown>): Y.Map<unknown>;
export function deepClone(t: Y.Text | Y.Map<unknown>): Y.Text | Y.Map<unknown> {
  return t instanceof Y.Text ? cloneText(t) : cloneMap(t);
}

function cloneValue(v: unknown): unknown {
  if (v instanceof Y.Text) return cloneText(v);
  if (v instanceof Y.Map) return cloneMap(v);
  if (v instanceof Y.Array) {
    const a = new Y.Array<unknown>();
    a.insert(0, v.toArray().map(cloneValue));
    return a;
  }
  return v;
}

function cloneMap(m: Y.Map<unknown>): Y.Map<unknown> {
  const out = new Y.Map<unknown>();
  m.forEach((v, k) => out.set(k, cloneValue(v)));
  return out;
}

function cloneText(t: Y.Text): Y.Text {
  const out = new Y.Text();
  let at = 0;
  for (const op of t.toDelta()) {
    const ins: unknown = op.insert;
    const raw: unknown = op.attributes;
    // An explicit `{}` (never undefined): Yjs would otherwise inherit the formats at `at`.
    const attrs: Record<string, unknown> = typeof raw === "object" && raw !== null ? { ...raw } : {};
    if (typeof ins === "string") {
      out.insert(at, ins, attrs);
      at += ins.length;
    } else if (typeof ins === "object" && ins !== null) {
      const v = cloneValue(ins);
      if (typeof v === "object" && v !== null) out.insertEmbed(at++, v, attrs);
    }
  }
  return out;
}
