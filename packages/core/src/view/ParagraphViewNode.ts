import Editor from '../Editor';
import BlockViewNode from './BlockViewNode';

export default class ParagraphViewNode extends BlockViewNode {
  protected domContainer: HTMLDivElement;

  constructor(editor: Editor, id: string) {
    super(editor, id);
    this.domContainer = document.createElement('div');
    this.domContainer.className = 'tw--paragraph-block';
    this.domContainer.setAttribute('data-tw-id', id);
    this.domContainer.setAttribute('data-tw-role', 'block');
  }

  getType() {
    return 'Paragraph';
  }

  getDOMContainer() {
    return this.domContainer;
  }
}
