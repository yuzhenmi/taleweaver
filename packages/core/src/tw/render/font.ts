export interface IFont {
    weight?: number;
    size?: number;
    family?: string;
    letterSpacing?: number;
    underline?: boolean;
    italic?: boolean;
    strikethrough?: boolean;
    color?: string;
}

export interface IFontWithDefault {
    weight: number;
    size: number;
    family: string;
    letterSpacing: number;
    underline: boolean;
    italic: boolean;
    strikethrough: boolean;
    color: string;
}

export const DEFAULT_FONT: IFont = {
    weight: 400,
    size: 14,
    family: 'sans-serif',
    letterSpacing: 0,
    underline: false,
    italic: false,
    strikethrough: false,
    color: 'black',
};

export function applyDefaultFont(fontConfig: IFont): IFontWithDefault {
    const fontConfigWithDefault: any = {};
    for (const key in DEFAULT_FONT) {
        if (key in fontConfig && (fontConfig as any)[key] !== undefined) {
            fontConfigWithDefault[key] = (fontConfig as any)[key];
        } else {
            fontConfigWithDefault[key] = (DEFAULT_FONT as any)[key];
        }
    }
    return fontConfigWithDefault as IFontWithDefault;
}
