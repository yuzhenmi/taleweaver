import ParagraphBlockBox from '../layout/ParagraphBlockBox';
import BlockView from './BlockView';
import LineView from './LineView';

export default class ParagraphBlockView extends BlockView {
  protected paragraphBlockBox: ParagraphBlockBox;
  protected domContainer: HTMLDivElement;

  constructor(paragraphBlockBox: ParagraphBlockBox) {
    super();
    this.paragraphBlockBox = paragraphBlockBox;
    this.domContainer = document.createElement('div');
    this.domContainer.className = 'tw--paragraph-block';
  }

  getDOMContainer(): HTMLDivElement {
    return this.domContainer;
  }

  insertChild(child: BlockView | LineView, offset: number) {
    if (child instanceof BlockView) {
      throw new Error('Error inserting child to paragraph block view, child cannot be block view.');
    }
    const childDOMContainer = child.getDOMContainer();
    if (offset > this.domContainer.childNodes.length) {
      throw new Error(`Error inserting child to paragraph block view, offset ${offset} is out of range.`);
    }
    if (offset === this.domContainer.childNodes.length) {
      this.domContainer.appendChild(childDOMContainer);
    } else {
      this.domContainer.insertBefore(childDOMContainer, this.domContainer.childNodes[offset + 1]);
    }
    this.domContainer.appendChild(childDOMContainer);
  }
}
