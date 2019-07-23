import Editor from '../Editor';
import ParagraphLayoutNode from '../layout/ParagraphLayoutNode';
import BlockViewNode from './BlockViewNode';

export default class ParagraphViewNode extends BlockViewNode {
  protected layoutNode: ParagraphLayoutNode;
  protected domContainer: HTMLDivElement;

  constructor(editor: Editor, layoutNode: ParagraphLayoutNode) {
    super(editor, layoutNode.getID());
    this.layoutNode = layoutNode;
    this.domContainer = document.createElement('div');
    this.domContainer.className = 'tw--paragraph-block';
    this.domContainer.setAttribute('data-tw-id', layoutNode.getID());
    this.domContainer.setAttribute('data-tw-role', 'block');
    this.updateDOM();
  }

  getType() {
    return 'Paragraph';
  }

  getDOMContainer() {
    return this.domContainer;
  }

  protected updateDOM() {
    const layoutNode = this.layoutNode;
    const domContainer = this.domContainer;
    domContainer.style.width = `${layoutNode.getWidth()}px`;
    domContainer.style.height = `${layoutNode.getHeight()}px`;
    domContainer.style.paddingTop = `${layoutNode.getPaddingTop()}px`;
    domContainer.style.paddingBottom = `${layoutNode.getPaddingBottom()}px`;
  }
}
