/** Test-only: drive model commands like an editor (one model, one origin, a selection). */
import { expect } from "vitest";
import type { Block } from "./block";
import { deriveDocument, type Document } from "./derive";
import { getEmbedContentIds, getTemplateContentIds } from "./document";
import { Model } from "./model";
import { BUILTIN_OBJECT_KINDS } from "./object-kinds";
import { applyPlan, type Plan } from "./plan";
import { caretAt, type ModelPosition, type ModelSelection } from "./position";
import type { CommandContext, CommandOptions } from "./commands";
import { createEditorOrigin } from "./storage";
import { childrenOf, expectSameVersion, fixture, type Fixture } from "./test-helpers";

export class Harness {
  readonly f: Fixture;
  readonly model: Model;
  readonly origin = createEditorOrigin();
  selection: ModelSelection;

  constructor(
    clientID = 1,
    readonly options: CommandOptions = {},
  ) {
    this.f = fixture(clientID);
    this.model = new Model(this.f.doc);
    this.selection = caretAt(this.paragraphs()[0]?.id ?? "", 0);
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
    const sel = applyPlan(this.model, p, this.origin);
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
    this.selection = caretAt(this.blockId(blockIndex), offset);
  }

  select(anchor: [number, number], focus: [number, number]): void {
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
    const p = (x: ModelPosition): string => `${ids.indexOf(x.blockId)}:${x.offset}`;
    const a = p(this.selection.anchor);
    const f = p(this.selection.focus);
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

export function line(b: Block): string {
  if (b.inlineContent === null) return b.type === "table-of-contents" ? "toc" : b.type;
  const text = b.inlineContent.items
    .map((i) => {
      if (i.kind === "text") return i.text;
      if (i.embedType === "object") return typeof i.properties["wrap"] === "string" ? `[img:${String(i.properties["wrap"])}]` : "[img]";
      if (i.embedType === "horizontal-line") return "[hr]";
      if (i.embedType === "footnote-anchor") return "[fn]";
      if (i.embedType === "marker") return `[${String(i.properties["edge"])}]`;
      return "[?]";
    })
    .join("");
  const attrs = Object.entries(b.attrs)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(",");
  return `${b.type}${attrs === "" ? "" : `(${attrs})`}:${text}`;
}

/** Type `text` with Enter at each "\n". */
export function typeLines(h: Harness, text: string, insertText: (ctx: CommandContext, t: string) => Plan | null, split: (ctx: CommandContext) => Plan | null): void {
  text.split("\n").forEach((part, i) => {
    if (i > 0) expect(h.run(split)).toBe(true);
    if (part !== "") expect(h.run(insertText, part)).toBe(true);
  });
}
