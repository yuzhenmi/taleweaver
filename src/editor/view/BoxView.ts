import LineView from './LineView';
import InlineElement from '../element/InlineElement';

export default abstract class BoxView {
  protected inlineElement?: InlineElement;
  protected lineView?: LineView;
  protected domElement?: HTMLElement | Text;

  setInlineElement(inlineElement: InlineElement) {
    this.inlineElement = inlineElement;
  }

  setLineView(lineView: LineView) {
    this.lineView = lineView;
  }

  abstract addToDOM(): void;

  getInlineElement(): InlineElement {
    return this.inlineElement!;
  }

  getLineView(): LineView {
    return this.lineView!;
  }

  getDOMElement(): HTMLElement | Text {
    return this.domElement!;
  }
}
