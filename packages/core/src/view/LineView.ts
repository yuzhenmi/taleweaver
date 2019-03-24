import LineBox from '../layout/LineBox';
import View from './View';
import InlineView from './InlineView';

export default class LineView extends View {
  protected lineBox: LineBox;
  protected domContainer: HTMLDivElement;

  constructor(lineBox: LineBox) {
    super();
    this.lineBox = lineBox;
    this.domContainer = document.createElement('div');
    this.domContainer.className = 'tw--line';
    this.domContainer.style.whiteSpace = 'pre';
  }

  getDOMContainer(): HTMLDivElement {
    return this.domContainer;
  }

  getDOMContentContainer(): HTMLDivElement {
    return this.domContainer;
  }

  insertChild(child: InlineView, offset: number) {
    const childDOMContainer = child.getDOMContainer();
    if (offset > this.domContainer.childNodes.length) {
      throw new Error(`Error inserting child to line view, offset ${offset} is out of range.`);
    }
    if (offset === this.domContainer.childNodes.length) {
      this.domContainer.appendChild(childDOMContainer);
    } else {
      this.domContainer.insertBefore(childDOMContainer, this.domContainer.childNodes[offset + 1]);
    }
    this.domContainer.appendChild(childDOMContainer);
  }
}
