/**
 * Test-only acceptance check for INVARIANT I — O(flow), never
 * used by production code.
 *
 * Over every visible holder flow (the document root, footnote / template bodies,
 * table cells, host containers), with BOUNDARIES = ¶ items (a section-end counts as
 * a ¶), object / table / container items and the flow end:
 *   - I1: every unit that is not a ¶ (a content unit or an object item) has a ¶ as its
 *     NEXT boundary — so the flow is non-empty, ends with a ¶ and no two objects are
 *     adjacent;
 *   - STATE check (local primitive ops only): the flow's last unit is a PLAIN ¶.
 *
 * Mode "storage" (after a local primitive op) checks I in storage. Mode "read" (after
 * a remote transaction or an undo / redo) checks I in the READ MODEL: every storage
 * violation is covered by an implicit paragraph (a holder's leaf sequence never has an
 * object without a text block after it, never ends without a text block, is never
 * empty; no section is empty) and nothing is lost (every live content unit of the
 * holder is read in exactly one text block).
 */
import * as Y from "yjs";
import type { BlockId } from "../state/block-id";
import { getBlock, resolveBlock, type Document } from "../state/state";
import { STATE_INTERNAL } from "../state/state-internal";
import { inlineContentLength } from "../state/inline-content";
import { getRegistry, entryFlow } from "../state/registry";
import { readCtx, eff, clen, deriveBlock, type ReadCtx } from "../state/flow-read";
import { firstUnitOfFlow, nextUnit } from "../state/y-flow";

type Token = "content" | "para" | "plain" | "object";

/** The live boundary / content tokens of one flow, in order. */
function tokensOf(ctx: ReadCtx, flow: Y.Array<Y.Text>): Token[] {
  const out: Token[] = [];
  for (let u = firstUnitOfFlow(flow); u !== null; u = nextUnit(u)) {
    const e = eff(ctx, u);
    if (e === null) {
      if (clen(ctx, u) > 0 && out[out.length - 1] !== "content") out.push("content");
      continue;
    }
    if (e.shape !== "text") out.push("object");
    else out.push(e.m.section === undefined ? "plain" : "para");
  }
  return out;
}

/** Ids of every holder whose flow is read (visible), with its flow. */
function visibleFlows(state: Document): { id: string; flow: Y.Array<Y.Text> }[] {
  const doc = state[STATE_INTERNAL].doc;
  const ctx = readCtx(doc);
  const out: { id: string; flow: Y.Array<Y.Text> }[] = [];
  for (const [id, entry] of getRegistry(doc).entries()) {
    const flow = entryFlow(entry);
    if (flow === null) continue;
    if (deriveBlock(ctx, id) === null) continue;
    out.push({ id, flow });
  }
  return out;
}

/** The first storage violation of I (and the state check), or null. */
export function storageViolation(state: Document, stateCheck = true): string | null {
  const doc = state[STATE_INTERNAL].doc;
  const ctx = readCtx(doc);
  for (const { id, flow } of visibleFlows(state)) {
    const toks = tokensOf(ctx, flow);
    if (toks.length === 0) return `flow ${id}: empty`;
    let pending = false;
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t === "content") pending = true;
      else if (t === "object") {
        if (pending) return `flow ${id}: unit before an object at token ${i} is not ¶-terminated (${toks.join(" ")})`;
        pending = true;
      } else pending = false;
    }
    if (pending) return `flow ${id}: tail not ¶-terminated (${toks.join(" ")})`;
    if (stateCheck && toks[toks.length - 1] !== "plain") return `flow ${id}: last unit is not a plain ¶ (${toks.join(" ")})`;
  }
  return null;
}

/** The first read-model violation of I (or a lost character), or null. */
export function readViolation(state: Document): string | null {
  const doc = state[STATE_INTERNAL].doc;
  const ctx = readCtx(doc);
  for (const { id, flow } of visibleFlows(state)) {
    const holder = resolveBlock(state, id as BlockId)?.block;
    if (holder === undefined) continue;
    // Covered cells read inside their anchor's concatenation: checked there.
    if (holder.type === "table-cell" && deriveBlock(ctx, id)?.block.id !== id) continue;
    const leaves: { kind: "text" | "object"; len: number }[] = [];
    const walk = (first: BlockId | null, inSection: boolean): string | null => {
      if (inSection && first === null) return "empty section";
      for (let c = first; c !== null; ) {
        const b = getBlockAny(state, c);
        if (b === null) return `dangling ${c}`;
        if (b.type === "section") {
          const bad = walk(b.firstChildId, true);
          if (bad !== null) return `section ${c}: ${bad}`;
        } else if (b.inlineContent !== null) leaves.push({ kind: "text", len: inlineContentLength(b.inlineContent) });
        else leaves.push({ kind: "object", len: 0 });
        c = b.nextSiblingId;
      }
      return null;
    };
    const bad = walk(holder.firstChildId, false);
    if (bad !== null) return `holder ${id}: ${bad}`;
    if (leaves.length === 0) return `holder ${id}: no children`;
    for (let i = 0; i < leaves.length; i++) {
      if (leaves[i]?.kind === "object" && leaves[i + 1]?.kind !== "text") return `holder ${id}: object at ${i} not followed by a paragraph`;
    }
    // Nothing lost: every live content unit of the holder's flow is read in a text block.
    let stored = 0;
    for (let u = firstUnitOfFlow(flow); u !== null; u = nextUnit(u)) if (eff(ctx, u) === null) stored += clen(ctx, u);
    const read = leaves.reduce((n, l) => n + l.len, 0);
    if (holder.type !== "table-cell" && read !== stored) return `holder ${id}: ${stored} stored content units, ${read} read`;
  }
  return null;
}

function getBlockAny(state: Document, id: BlockId) {
  return getBlock(state, id) ?? resolveBlock(state, id)?.block ?? null;
}

/**
 * The storage of `holderId`'s flow as a string: each ¶ as `id:"text"` (a section-end
 * as `id:"text"/S`), each object as `[id]`, an unterminated tail as `~"text"`.
 */
export function flowShape(state: Document, holderId: string): string {
  const doc = state[STATE_INTERNAL].doc;
  const ctx = readCtx(doc);
  const entry = getRegistry(doc).get(holderId);
  const flow = entry === undefined ? null : entryFlow(entry);
  if (flow === null) throw new Error(`flowShape: "${holderId}" holds no flow`);
  const out: string[] = [];
  let text = "";
  for (let u = firstUnitOfFlow(flow); u !== null; u = nextUnit(u)) {
    const e = eff(ctx, u);
    if (e === null) {
      if (clen(ctx, u) === 0) continue;
      const c = u.content;
      text += c instanceof Y.ContentString ? c.str : "￼";
      continue;
    }
    if (e.shape !== "text") {
      if (text !== "") out.push(`~"${text}"`);
      text = "";
      out.push(`[${e.m.end}]`);
      continue;
    }
    out.push(`${e.m.end}:"${text}"${e.m.section === undefined ? "" : `/${e.m.section}`}`);
    text = "";
  }
  if (text !== "") out.push(`~"${text}"`);
  return out.join(" ");
}

/**
 * Assert invariant I: in STORAGE (+ the plain-¶ state check) after a local
 * primitive op, in the READ MODEL after a remote transaction / undo / redo.
 */
export function assertInvariantI(state: Document, mode: "storage" | "read", label = ""): void {
  const bad = mode === "storage" ? (storageViolation(state) ?? readViolation(state)) : readViolation(state);
  if (bad !== null) throw new Error(`invariant I (${mode}) ${label}: ${bad}`);
}
