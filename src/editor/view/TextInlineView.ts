import InlineView from './InlineView';

export default class TextInlineView extends InlineView {
  protected domContainer: HTMLDivElement;

  constructor() {
    super();
    this.domContainer = document.createElement('div');
    this.domContainer.className = 'tw--text-inline';
  }

  getDOMContainer(): HTMLDivElement {
    return this.domContainer;
  }
}
