export type Region = "header" | "footer";
export type Variant = "default" | "first" | "even";

export const linkKey = (region: Region, variant: Variant): string => `h:${region}:${variant}`;
export const linkAttr = (region: Region, variant: Variant): string => (variant === "default" ? `${region}BlockId` : `${region}${variant.charAt(0).toUpperCase()}${variant.slice(1)}BlockId`);
