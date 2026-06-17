import type { Style, ComputedStyle } from "../styles";
import type { LayoutBoxMetadata } from "./layout-metadata";

export type RenderNode = ElementBox | TextBox;

export interface ElementBox {
  readonly type: "element";
  readonly key: string;
  readonly style: Readonly<Style>;
  readonly computedStyle?: Readonly<ComputedStyle>;
  readonly metadata?: Readonly<LayoutBoxMetadata>;
  readonly children: readonly RenderNode[];
}

export interface TextBox {
  readonly type: "text";
  readonly key: string;
  readonly style: Readonly<Style>;
  readonly computedStyle?: Readonly<ComputedStyle>;
  readonly text: string;
  readonly link?: string;
}

export function createElementBox(
  key: string,
  style: Style,
  children: readonly RenderNode[],
  metadata?: Readonly<LayoutBoxMetadata>,
): ElementBox {
  return Object.freeze({
    type: "element" as const,
    key,
    style: Object.freeze({ ...style }),
    children: Object.freeze([...children]),
    ...(metadata !== undefined
      ? { metadata: Object.freeze({ ...metadata }) }
      : {}),
  });
}

export function createTextBox(
  key: string,
  style: Style,
  text: string,
  link?: string,
): TextBox {
  return Object.freeze({
    type: "text" as const,
    key,
    style: Object.freeze({ ...style }),
    text,
    ...(link !== undefined ? { link } : {}),
  });
}
