import LineView from './LineView';
import Word from '../element/Word';

type BoxViewConfig = {
}

export type BoxViewScreenPosition = {
  left: number;
  width: number;
  height: number;
}

export default abstract class BoxView {
  protected config: BoxViewConfig;
  protected word?: Word;
  protected lineView?: LineView;
  protected domElement?: HTMLElement | Text;

  constructor(config: BoxViewConfig) {
    this.config = config;
  }

  setLineView(lineView: LineView) {
    this.lineView = lineView;
  }

  setWord(word: Word) {
    this.word = word;
  }

  abstract bindToDOM(): void;

  getConfig(): BoxViewConfig {
    return this.config;
  }

  getWord(): Word {
    return this.word!;
  }

  getLineView(): LineView {
    return this.lineView!;
  }

  getDOMElement(): HTMLElement | Text {
    return this.domElement!;
  }

  abstract getWidth(): number;
  abstract getHeight(): number;

  getSize(): number {
    return this.getWord().getSize();
  }

  abstract getScreenPosition(from: number, to: number): BoxViewScreenPosition;
  abstract getDocumentPosition(screenPosition: number): number;
}
