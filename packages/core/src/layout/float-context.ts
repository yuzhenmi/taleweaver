export interface PlacedFloat {
  side: "left" | "right";
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FloatContext {
  placeFloat(f: PlacedFloat): void;
  activeAt(y: number): { leftWidth: number; rightWidth: number; nearestBottom: number };
  clearY(side: "left" | "right" | "both", y: number): number;
  lowestBottom(): number;
}

export function createFloatContext(): FloatContext {
  const floats: PlacedFloat[] = [];

  return {
    placeFloat(f) { floats.push(f); },

    activeAt(y) {
      let leftWidth = 0;
      let rightWidth = 0;
      let nearestBottom = Infinity;
      for (const f of floats) {
        const bottom = f.y + f.height;
        if (y >= f.y && y < bottom) {
          if (f.side === "left") leftWidth += f.width;
          else rightWidth += f.width;
          if (bottom < nearestBottom) nearestBottom = bottom;
        }
      }
      return { leftWidth, rightWidth, nearestBottom };
    },

    clearY(side, y) {
      let result = y;
      for (const f of floats) {
        const matches = side === "both" || f.side === side;
        if (!matches) continue;
        const bottom = f.y + f.height;
        if (bottom > result) result = bottom;
      }
      return result;
    },

    lowestBottom() {
      return floats.reduce((m, f) => Math.max(m, f.y + f.height), 0);
    },
  };
}
