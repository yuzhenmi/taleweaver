import { DEFAULT_STYLE } from '../config/TextConfig';
import Editor from '../Editor';
import LineBreakInlineBox from '../layout/LineBreakLayoutNode';
import InlineViewNode from './InlineViewNode';

export default class LineBreakInlineViewNode extends InlineViewNode {
  protected domContainer: HTMLSpanElement;

  constructor(editor: Editor, id: string) {
    super(editor, id);
    this.domContainer = document.createElement('span');
    this.domContainer.className = 'tw--line-break-inline';
    this.domContainer.setAttribute('data-tw-id', id);
    this.domContainer.setAttribute('data-tw-role', 'inline');
    this.domContainer.style.display = 'inline-block';
    this.domContainer.style.whiteSpace = 'pre';
    this.domContainer.style.lineHeight = '1em';
    this.domContainer.innerText = ' ';
  }

  getDOMContainer() {
    return this.domContainer;
  }

  onDeleted() {
  }

  onLayoutUpdated(layoutNode: LineBreakInlineBox) {
    // const textStyle = layoutNode.getTextStyle();
    const textStyle = DEFAULT_STYLE;
    this.selectableSize = layoutNode.getSelectableSize();
    this.domContainer.style.paddingTop = `${layoutNode.getPaddingTop()}px`;
    this.domContainer.style.paddingBottom = `${layoutNode.getPaddingBottom()}px`;
    this.domContainer.style.fontFamily = textStyle.font;
    this.domContainer.style.fontSize = `${textStyle.size}px`;
    this.domContainer.style.fontWeight = `${textStyle.weight}`;
    this.domContainer.style.fontStyle = textStyle.italic ? 'italic' : null;
  }
}
