import type { SelectionRect } from "@taleweaver/dom";

interface SelectionViewProps {
  rects: SelectionRect[];
}

export function SelectionView({ rects }: SelectionViewProps) {
  return (
    <>
      {rects.map((rect, i) => (
        <div
          key={`sel-${i}`}
          style={{
            position: "absolute",
            left: rect.x,
            top: rect.y,
            width: rect.width,
            height: rect.height,
            backgroundColor: "rgba(59, 130, 246, 0.3)",
            pointerEvents: "none",
          }}
        />
      ))}
    </>
  );
}
