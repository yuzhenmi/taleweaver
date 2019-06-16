interface Font {
  name: string;
  src: string | null;
}

class FontConfig {
  protected fonts: Map<string, Font> = new Map();
  protected defaultFont: Font | null = null;

  constructor() {
    this.registerFont('serif', null);
    this.registerFont('sans-serif', null, true);
    this.registerFont('monospace', null);
    this.registerFont('cursive', null);
    this.registerFont('fantasy', null);
  }

  registerFont(name: string, src: string | null, isDefault: boolean = false) {
    const font = { name, src };
    this.fonts.set(name, font);
    if (isDefault) {
      this.defaultFont = font;
    }
  }

  getFont(name: string) {
    if (!this.fonts.has(name)) {
      throw new Error(`Font ${name} is not registered.`);
    }
    return this.fonts.get(name)!;
  }

  getDefaultFont() {
    if (!this.defaultFont) {
      throw new Error(`There is no default font configured.`);
    }
    return this.defaultFont;
  }
}

export default FontConfig;
