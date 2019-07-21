import Editor from '../Editor';
import InlineViewNode from './InlineViewNode';

export default class TextViewNode extends InlineViewNode {
  protected domContainer: HTMLSpanElement;
  protected domContent: HTMLSpanElement;

  constructor(editor: Editor, id: string) {
    super(editor, id);
    this.domContainer = document.createElement('span');
    this.domContainer.className = 'tw--text-inline';
    this.domContainer.setAttribute('data-tw-id', id);
    this.domContainer.setAttribute('data-tw-role', 'inline');
    this.domContainer.style.display = 'inline-block';
    this.domContainer.style.whiteSpace = 'pre';
    this.domContainer.style.lineHeight = '1em';
    this.domContent = document.createElement('span');
    this.domContent.className = 'tw--text-inline-content';
    this.domContainer.appendChild(this.domContent);
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
}
