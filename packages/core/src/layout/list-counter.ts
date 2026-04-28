export type CounterStyle = "decimal" | "lower-alpha" | "upper-alpha" | "lower-roman" | "upper-roman";

export function formatCounter(value: number, style: CounterStyle): string {
  switch (style) {
    case "decimal":
      return `${value}.`;
    case "lower-alpha":
      return `${toAlpha(value, "a")}.`;
    case "upper-alpha":
      return `${toAlpha(value, "A")}.`;
    case "lower-roman":
      return `${toRoman(value).toLowerCase()}.`;
    case "upper-roman":
      return `${toRoman(value)}.`;
  }
}

function toAlpha(n: number, base: "a" | "A"): string {
  let s = "";
  let cur = n;
  while (cur > 0) {
    cur--;
    const c = String.fromCharCode(base.charCodeAt(0) + (cur % 26));
    s = c + s;
    cur = Math.floor(cur / 26);
  }
  return s;
}

function toRoman(n: number): string {
  const pairs: [number, string][] = [
    [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"],
    [100,  "C"], [90,  "XC"], [50,  "L"], [40,  "XL"],
    [10,   "X"], [9,   "IX"], [5,   "V"], [4,   "IV"], [1, "I"],
  ];
  let s = "";
  let cur = n;
  for (const [v, lit] of pairs) {
    while (cur >= v) { s += lit; cur -= v; }
  }
  return s;
}
