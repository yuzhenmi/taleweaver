import TextInlineBox from '../layout/TextInlineBox';
import TextAtomicBox from '../layout/TextAtomicBox';
import InlineViewNode from './InlineViewNode';

export default class TextInlineViewNode extends InlineViewNode {
  protected domContainer: HTMLSpanElement;

  constructor(id: string) {
    super(id);
    this.domContainer = document.createElement('span');
    this.domContainer.className = 'tw--text-inline';
    this.domContainer.style.whiteSpace = 'pre';
  }

  getDOMContainer(): HTMLSpanElement {
    return this.domContainer;
  }

  onDeleted() {
    if (this.domContainer.parentElement) {
      this.domContainer.parentElement.removeChild(this.domContainer);
    }
  }

  onLayoutUpdated(layoutNode: TextInlineBox) {
    const text = layoutNode.getChildren().map(child => {
      if (child instanceof TextAtomicBox) {
        return child.getContent();
      } else {
        throw new Error(`Invalid child AtomicBox encountered for TextInlineBox.`);
      }
    }).join('');
    this.domContainer.innerText = text;
  }
}
