import TextInlineBox from '../layout/TextInlineBox';
import TextAtomicBox from '../layout/TextAtomicBox';
import InlineViewNode from './InlineViewNode';

export default class TextInlineViewNode extends InlineViewNode {
  protected domContainer: HTMLSpanElement;

  constructor(id: string) {
    super(id);
    this.domContainer = document.createElement('span');
    // @ts-ignore
    this.domContainer.$viewNode = this;
    this.domContainer.className = 'tw--text-inline';
    this.domContainer.setAttribute('data-tw-id', id);
    this.domContainer.style.color = 'transparent';
    this.domContainer.style.textShadow = '0 0 0 black';
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

  resolveSelectionOffset(offset: number): number {
    return offset;
  }
}
