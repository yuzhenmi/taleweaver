import Editor from '../Editor';
import TextLayoutNode from '../layout/TextLayoutNode';
import TextWordLayoutNode from '../layout/TextWordLayoutNode';
import InlineViewNode from './InlineViewNode';

export default class TextViewNode extends InlineViewNode {
  protected layoutNode: TextLayoutNode;
  protected domContainer: HTMLSpanElement;
  protected domContent: HTMLSpanElement;

  constructor(editor: Editor, layoutNode: TextLayoutNode) {
    super(editor, layoutNode.getID());
    this.layoutNode = layoutNode;
    this.domContainer = document.createElement('span');
    this.domContainer.className = 'tw--text-inline';
    this.domContainer.setAttribute('data-tw-id', layoutNode.getID());
    this.domContainer.setAttribute('data-tw-role', 'inline');
    this.domContainer.style.display = 'inline-block';
    this.domContainer.style.whiteSpace = 'pre';
    this.domContainer.style.lineHeight = '1em';
    this.domContent = document.createElement('span');
    this.domContent.className = 'tw--text-inline-content';
    this.domContainer.appendChild(this.domContent);
    this.updateDOM();
  }

  getType() {
    return 'Text';
  }

  getSize() {
    return 0;
  }

  clearCache() { }

  getDOMContainer() {
    return this.domContainer;
  }

  protected updateDOM() {
    const layoutNode = this.layoutNode;
    const textStyle = layoutNode.getTextStyle();
    const text = layoutNode.getChildNodes().map(childNode => {
      if (childNode instanceof TextWordLayoutNode) {
        return childNode.getContent();
      }
      return '';
    }).join('');
    const domContainer = this.domContainer;
    const domContent = this.domContent;
    domContainer.style.paddingTop = `${layoutNode.getPaddingTop()}px`;
    domContainer.style.paddingBottom = `${layoutNode.getPaddingBottom()}px`;
    domContainer.style.fontFamily = textStyle.font;
    domContainer.style.fontSize = `${textStyle.size}px`;
    domContainer.style.letterSpacing = `${textStyle.letterSpacing}px`;
    domContainer.style.fontWeight = `${textStyle.weight}`;
    domContainer.style.color = textStyle.color;
    domContainer.style.textDecoration = textStyle.underline ? 'underline' : null;
    domContainer.style.fontStyle = textStyle.italic ? 'italic' : null;
    domContent.style.textDecoration = textStyle.strikethrough ? 'line-through' : null;
    domContent.innerText = text;
  }
}
