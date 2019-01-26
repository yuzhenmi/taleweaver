import LineView from './LineView';
import { Atom } from '../element/InlineElement';

type BoxViewConfig = {
}

export type BoxViewScreenPosition = {
  left: number;
  width: number;
  height: number;
}

export default abstract class BoxView {
  protected config: BoxViewConfig;
  protected atom?: Atom;
  protected lineView?: LineView;
  protected domElement?: HTMLElement | Text;

  constructor(config: BoxViewConfig) {
    this.config = config;
  }

  setLineView(lineView: LineView) {
    this.lineView = lineView;
  }

  setAtom(atom: Atom) {
    this.atom = atom;
  }

  abstract addToDOM(): void;

  getConfig(): BoxViewConfig {
    return this.config;
  }

  getAtom(): Atom {
    return this.atom!;
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
    return this.getAtom().getSize();
  }

  abstract getScreenPosition(from: number, to: number): BoxViewScreenPosition;
}
