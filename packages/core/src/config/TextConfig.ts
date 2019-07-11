import { TextStyle } from '../model/TextModelNode';

export const DEFAULT_STYLE: TextStyle = {
  weight: 400,
  size: 16,
  color: 'rgba(0, 0, 0, 1)',
  font: 'Arial',
  letterSpacing: 0,
  italic: false,
  underline: false,
  strikethrough: false,
};

interface Font {
  name: string;
  src: string | null;
}

class TextConfig {
  protected fonts: Map<string, Font> = new Map();
  protected defaultStyle: TextStyle;

  constructor() {
    this.defaultStyle = DEFAULT_STYLE;
  }

  registerFont(name: string, src: string | null) {
    const font = { name, src };
    this.fonts.set(name, font);
  }

  getDefaultStyle() {
    return this.defaultStyle;
  }
}

export default TextConfig;
