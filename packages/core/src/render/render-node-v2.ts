import type { Style, ComputedStyle } from "../styles";

export type RenderNode = ElementBox | TextBox;

export interface ElementBox {
  readonly type: "element";
  readonly key: string;
  readonly style: Readonly<Style>;
  readonly computedStyle?: Readonly<ComputedStyle>;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly children: readonly RenderNode[];
}

export interface TextBox {
  readonly type: "text";
  readonly key: string;
  readonly style: Readonly<Style>;
  readonly computedStyle?: Readonly<ComputedStyle>;
  readonly text: string;
}

export function createElementBox(
  key: string,
  style: Style,
  children: readonly RenderNode[],
  metadata?: Record<string, unknown>,
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
): TextBox {
  return Object.freeze({
    type: "text" as const,
    key,
    style: Object.freeze({ ...style }),
    text,
  });
}
