/** Test-only: drive model commands like an editor (one model, one origin, a selection). */
import { expect } from "vitest";
import * as Y from "yjs";
import type { Block, InlineItem } from "../block";
import type { CommandContext, CommandOptions } from "../commands/command-context";
import { insertText } from "../commands/insert-text";
import { splitParagraph } from "../commands/split-paragraph";
import { deriveDocument } from "../derive/derive-document";
import { getEmbedContentIds, getTemplateContentIds } from "../document/blocks";
import type { Document, TreeKind } from "../document/types";
import { type HistoryStep, ModelHistory } from "../history";
import { Model } from "../model";
import { BUILTIN_OBJECT_KINDS } from "../object-kinds";
import { OPTIONS, editKindOf } from "../oracle/random-command";
import type { Plan } from "../plan";
import { type ModelPosition, type ModelSelection, caretAt, isAllSelection, isObjectSelection, isTextSelection } from "../position/model-position";
import { resolvePosition } from "../position/resolve-position";
import { createEditorOrigin } from "../storage/history-hooks";
import { expectSameVersion } from "./expect-same-version";
import { type Fixture, childrenOf, fixture } from "./fixture";

export class Harness {
  readonly f: Fixture;
  readonly model: Model;
  readonly origin = createEditorOrigin();
  readonly history: ModelHistory;
  /** The history's clock (ms); every `run` advances it past the coalescing pause unless `tick` says otherwise. */
  clock = 0;
  tick = 1000;
  selection: ModelSelection;

  constructor(
    clientID = 1,
    readonly options: CommandOptions = {},
    /** A replica of this document (synced once at construction). */
    from?: Harness,
  ) {
    this.f = fixture(clientID, from?.f.doc);
    this.model = new Model(this.f.doc);
    this.history = new ModelHistory(this.model, this.origin, () => this.clock);
    this.selection = caretAt(this.paragraphs()[0]?.id ?? "", 0);
  }

  /** Undo (true when something was undone); the selection moves to the restored one. */
  undo(): boolean {
    return this.restore(this.history.undo());
  }

  redo(): boolean {
    return this.restore(this.history.redo());
  }

  /** Applies an undo / redo's result: false when nothing was undone; a selection that no longer resolves leaves the current one. */
  private restore(step: HistoryStep | null): boolean {
    if (step === null) return false;
    if (step.selection !== null) this.selection = step.selection;
    expectSameVersion(this.model.version, deriveDocument(this.f.doc, BUILTIN_OBJECT_KINDS));
    return true;
  }

  /** Everything a reader sees, without ids ({@link readOf}). */
  read(): unknown {
    return readOf(this.model.version);
  }

  /** The selection without ids ({@link selectionOf}). */
  readSelection(): string {
    return selectionOf(this.model.version, this.selection);
  }

  get version(): Document {
    return this.model.version;
  }

  ctx(): CommandContext {
    return { version: this.model.version, selection: this.selection, options: this.options };
  }

  /** Plan + apply a command; returns whether anything was written. Checks incremental == scratch. */
  run<A extends unknown[]>(cmd: (ctx: CommandContext, ...args: A) => Plan | null, ...args: A): boolean {
    const p = cmd(this.ctx(), ...args);
    if (p === null) return false;
    this.clock += this.tick;
    const sel = this.history.apply(p, editKindOf(cmd), this.selection);
    if (sel === null) throw new Error("harness: stale plan");
    this.selection = sel;
    expectSameVersion(this.model.version, deriveDocument(this.f.doc, BUILTIN_OBJECT_KINDS));
    return true;
  }

  /** The body flow's blocks in order. */
  paragraphs(): Block[] {
    const d = this.model.version;
    return childrenOf(d, "block", d.rootId).flatMap((s) => childrenOf(d, "block", s.id));
  }

  caret(blockIndex: number, offset: number): void {
    this.history.breakCoalescing();
    this.selection = caretAt(this.blockId(blockIndex), offset);
  }

  select(anchor: [number, number], focus: [number, number]): void {
    this.history.breakCoalescing();
    this.selection = { anchor: this.at(...anchor), focus: this.at(...focus) };
  }

  at(blockIndex: number, offset: number): ModelPosition {
    return { blockId: this.blockId(blockIndex), offset };
  }

  blockId(i: number): string {
    const b = this.paragraphs()[i];
    if (b === undefined) throw new Error(`harness: no block ${i}`);
    return b.id;
  }

  /** The body as `type:text` lines (`toc` for a TOC, `|` between sections, embeds as `[kind]`). */
  dump(): string[] {
    const d = this.model.version;
    const out: string[] = [];
    const sections = childrenOf(d, "block", d.rootId);
    sections.forEach((s, i) => {
      if (i > 0) out.push("|");
      for (const b of childrenOf(d, "block", s.id)) out.push(line(b));
    });
    return out;
  }

  /** The caret / selection as [blockIndex, offset] pairs. */
  sel(): string {
    const ids = this.paragraphs().map((b) => b.id);
    const s = this.selection;
    if (isObjectSelection(s)) return `object ${ids.indexOf(s.object)}`;
    if (isAllSelection(s)) return "all";
    const p = (x: ModelPosition): string => `${ids.indexOf(x.blockId)}:${x.offset}`;
    const a = p(s.anchor);
    const f = p(s.focus);
    return a === f ? a : `${a}-${f}`;
  }

  footnoteBodies(): string[][] {
    const d = this.model.version;
    return getEmbedContentIds(d).map((id) => childrenOf(d, "embedContent", id).map(line));
  }

  templateBodies(): string[][] {
    const d = this.model.version;
    return getTemplateContentIds(d).map((id) => childrenOf(d, "templateContent", id).map(line));
  }
}

/**
 * Everything a reader of `d` sees, without ids: the body by section (each footnote's
 * body in place of its anchor), header / footer bodies, section and list props.
 */
export function readOf(d: Document): unknown {
  const sections = childrenOf(d, "block", d.rootId);
  // A table's rows / cells / cell contents nest under it.
  const blocks = (tree: TreeKind, id: string): unknown[] =>
    childrenOf(d, tree, id).map((b) => ({
      type: b.type,
      attrs: b.attrs,
      markAttrs: b.markAttrs,
      items: b.inlineContent?.items.map(inline),
      children: b.firstChildId === null ? undefined : blocks(tree, b.id),
    }));
  const inline = (i: InlineItem): unknown => {
    const body = i.kind === "embed" ? i.properties["contentBlockId"] : undefined;
    return typeof body === "string" ? { kind: "footnote", attrs: i.attrs, body: blocks("embedContent", body) } : i;
  };
  return {
    body: sections.map((s) => blocks("block", s.id)),
    sections: sections.map((s) => s.attrs),
    templates: getTemplateContentIds(d).map((id) => blocks("templateContent", id)),
    lists: [...d.listDefs],
  };
}

/** A selection of `d` without ids: `flow.block:offset` per end (flow 0 = the body, then footnote bodies in anchor order, then header / footer bodies; a flow's blocks are its records depth first, table rows / cells / their contents in place); `object flow.index` / `all flow` for those kinds. */
export function selectionOf(d: Document, sel: ModelSelection): string {
  const under = (tree: TreeKind, id: string): Block[] => childrenOf(d, tree, id).flatMap((b) => [b, ...under(tree, b.id)]);
  const body = childrenOf(d, "block", d.rootId).flatMap((s) => under("block", s.id));
  const footnotes = body.flatMap((b) => (b.inlineContent?.items ?? []).flatMap((i) => (i.kind === "embed" && typeof i.properties["contentBlockId"] === "string" ? [i.properties["contentBlockId"]] : [])));
  const templates = getTemplateContentIds(d);
  const holders = [d.rootId, ...footnotes, ...templates];
  const flows: Block[][] = [body, ...footnotes.map((id) => under("embedContent", id)), ...templates.map((id) => under("templateContent", id))];
  const at = (id: string): string => {
    const f = flows.findIndex((bs) => bs.some((b) => b.id === id));
    return `${f}.${flows[f]?.findIndex((b) => b.id === id) ?? -1}`;
  };
  if (isAllSelection(sel)) return `all ${holders.indexOf(sel.container)}`;
  if (isObjectSelection(sel)) return `object ${at(sel.object)}`;
  return `${at(sel.anchor.blockId)}:${sel.anchor.offset}-${at(sel.focus.blockId)}:${sel.focus.offset}`;
}

export function line(b: Block): string {
  if (b.inlineContent === null) return b.type === "table-of-contents" ? "toc" : b.type;
  const text = b.inlineContent.items
    .map((i) => {
      if (i.kind === "text") return i.text;
      if (i.embedType === "object") return typeof i.properties["wrap"] === "string" ? `[img:${String(i.properties["wrap"])}]` : "[img]";
      if (i.embedType === "horizontal-line") return "[hr]";
      if (i.embedType === "footnote-anchor") return "[fn]";
      if (i.embedType === "marker") return `[${String(i.properties["edge"])}]`;
      if (i.embedType === "hard-break") return "[br]";
      if (i.embedType === "page-field") return `[field:${String(i.properties["fieldKind"])}]`;
      return "[?]";
    })
    .join("");
  const attrs = Object.entries(b.attrs)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(",");
  return `${b.type}${attrs === "" ? "" : `(${attrs})`}:${text}`;
}

/** The ends of a text selection that are no caret stop of `d` (each as a message). */
export function caretErrors(d: Document, sel: ModelSelection): string[] {
  if (!isTextSelection(sel)) return [];
  return [sel.anchor, sel.focus].flatMap((p) => {
    const r = resolvePosition(d, p, OPTIONS);
    return r === null ? [`caret ${p.blockId}:${p.offset} does not resolve`] : r.offset !== p.offset ? [`caret ${p.blockId}:${p.offset} is no stop (→ ${r.offset})`] : [];
  });
}

/** Sync every pending update between the harnesses (all pairs). */
export function sync(...hs: Harness[]): void {
  for (const a of hs) for (const b of hs) if (a !== b) Y.applyUpdate(b.f.doc, Y.encodeStateAsUpdate(a.f.doc, Y.encodeStateVector(b.f.doc)), "remote");
}

/** Two peers on one document: `b` is a replica of `a` after typing `text`. */
export function pair(text: string, ids: [number, number] = [1, 2]): [Harness, Harness] {
  const a = new Harness(ids[0]);
  typeLines(a, text, insertText, splitParagraph);
  return [a, new Harness(ids[1], {}, a)];
}

/** Type `text` with Enter at each "\n". */
export function typeLines(h: Harness, text: string, insertText: (ctx: CommandContext, t: string) => Plan | null, split: (ctx: CommandContext) => Plan | null): void {
  text.split("\n").forEach((part, i) => {
    if (i > 0) expect(h.run(split)).toBe(true);
    if (part !== "") expect(h.run(insertText, part)).toBe(true);
  });
}
