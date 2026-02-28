import type { ReactElement } from "react";
import type { LayoutBox } from "@taleweaver/core";

/** Render a LayoutBox tree as React elements with absolute positioning. */
export function renderLayoutTree(box: LayoutBox): ReactElement {
  if (box.type === "text") {
    const textStyle: React.CSSProperties = {
      position: "absolute",
      left: box.x,
      top: box.y,
      whiteSpace: "pre",
    };
    if (box.styles?.fontWeight) textStyle.fontWeight = box.styles.fontWeight;
    if (box.styles?.fontStyle) textStyle.fontStyle = box.styles.fontStyle;
    if (box.styles?.textDecoration)
      textStyle.textDecoration = box.styles.textDecoration;

    return (
      <span key={box.key} style={textStyle}>
        {box.text}
      </span>
    );
  }

  const style: React.CSSProperties = {
    position: "absolute",
    left: box.x,
    top: box.y,
    width: box.width,
    height: box.height,
  };

  return (
    <div key={box.key} style={style}>
      {box.children.map((child) => renderLayoutTree(child))}
    </div>
  );
}
