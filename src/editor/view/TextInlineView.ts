import InlineView from './InlineView';
import TextInlineBox from '../layout/TextInlineBox';
import TextAtomicBox from '../layout/TextAtomicBox';

export default class TextInlineView extends InlineView {
  protected textInlineBox: TextInlineBox;
  protected domContainer: HTMLDivElement;

  constructor(textInlineBox: TextInlineBox) {
    super();
    this.textInlineBox = textInlineBox;
    this.domContainer = document.createElement('div');
    this.domContainer.className = 'tw--text-inline';
    const text = textInlineBox.getChildren().map(child => {
      if (child instanceof TextAtomicBox) {
        return child.getContent();
      } else {
        throw new Error(`Invalid child AtomicBox encountered for TextInlineBox.`);
      }
    }).join('');
    this.domContainer.innerText = text;
  }

  getDOMContainer(): HTMLDivElement {
    return this.domContainer;
  }
}
