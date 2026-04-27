export type Length =
  | number
  | { readonly unit: "px"; readonly value: number }
  | { readonly unit: "percent"; readonly value: number }
  | { readonly unit: "em"; readonly value: number };

export type LengthOrAuto = Length | "auto";
