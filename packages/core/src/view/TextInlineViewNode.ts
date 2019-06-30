import Editor from '../Editor';
import TextInlineBox from '../layout/TextInlineBox';
import TextAtomicBox from '../layout/TextAtomicBox';
import InlineViewNode from './InlineViewNode';

export default class TextInlineViewNode extends InlineViewNode {
  protected domContainer: HTMLSpanElement;

  constructor(editor: Editor, id: string) {
    super(editor, id);
    this.domContainer = document.createElement('span');
    this.domContainer.className = 'tw--text-inline';
    this.domContainer.setAttribute('data-tw-id', id);
    this.domContainer.setAttribute('data-tw-role', 'inline');
    this.domContainer.style.display = 'inline-block';
    this.domContainer.style.whiteSpace = 'pre';
    this.domContainer.style.lineHeight = '1em';
  }

  getDOMContainer() {
    return this.domContainer;
  }

  onDeleted() {
  }

  onLayoutUpdated(layoutNode: TextInlineBox) {
    const textStyle = layoutNode.getTextStyle();
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
    this.domContainer.style.fontFamily = textStyle.font;
    this.domContainer.style.fontSize = `${textStyle.size}px`;
    this.domContainer.style.letterSpacing = `${textStyle.letterSpacing}px`;
    this.domContainer.style.fontWeight = `${textStyle.weight}`;
    this.domContainer.style.color = textStyle.color;
    this.domContainer.style.textDecoration = textStyle.underline ? 'underline' : null;
    this.domContainer.style.fontStyle = textStyle.italic ? 'italic' : null;
  }

  resolveSelectionOffset(offset: number) {
    return offset;
  }

  resolveSelectableOffsetToNodeOffset(offset: number): [Node, number] {
    if (!this.domContainer.firstChild) {
      throw new Error('Text inline view is not built properly.');
    }
    return [this.domContainer.firstChild, offset];
  }
}
