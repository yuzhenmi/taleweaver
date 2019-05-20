import TextInlineBox from '../layout/TextInlineBox';
import TextAtomicBox from '../layout/TextAtomicBox';
import InlineViewNode from './InlineViewNode';

export default class TextInlineViewNode extends InlineViewNode {
  protected domContainer: HTMLSpanElement;

  constructor(id: string) {
    super(id);
    this.domContainer = document.createElement('span');
    this.domContainer.className = 'tw--text-inline';
    this.domContainer.setAttribute('data-tw-id', id);
    this.domContainer.setAttribute('data-tw-role', 'inline');
    this.domContainer.style.display = 'inline-block';
    this.domContainer.style.color = 'black';
    this.domContainer.style.fontSize = '18px';
    this.domContainer.style.lineHeight = '1.5em';
    this.domContainer.style.paddingTop = '0px';
    this.domContainer.style.paddingBottom = '0px';
  }

  getDOMContainer(): HTMLSpanElement {
    return this.domContainer;
  }

  onDeleted() {
  }

  onLayoutUpdated(layoutNode: TextInlineBox) {
    this.selectableSize = layoutNode.getSelectableSize();
    const text = layoutNode.getChildren().map(child => {
      if (child instanceof TextAtomicBox) {
        return child.getContent();
      } else {
        throw new Error(`Invalid child AtomicBox encountered for TextInlineBox.`);
      }
    }).join('');
    this.domContainer.innerText = text;
    this.domContainer.style.paddingTop = `${layoutNode.getPaddingTop()}px`;
    this.domContainer.style.paddingBottom = `${layoutNode.getPaddingBottom()}px`;
  }

  resolveSelectionOffset(offset: number): number {
    return offset;
  }

  resolveSelectableOffsetToNodeOffset(offset: number): [Node, number] {
    if (!this.domContainer.firstChild) {
      throw new Error('Text inline view is not built properly.');
    }
    return [this.domContainer.firstChild, offset];
  }
}
