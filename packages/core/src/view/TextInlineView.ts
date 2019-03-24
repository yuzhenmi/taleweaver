import InlineView from './InlineView';
import TextInlineBox from '../layout/TextInlineBox';
import TextAtomicBox from '../layout/TextAtomicBox';

export default class TextInlineView extends InlineView {
  protected textInlineBox: TextInlineBox;
  protected domContainer: HTMLSpanElement;

  constructor(textInlineBox: TextInlineBox) {
    super();
    this.textInlineBox = textInlineBox;
    this.domContainer = document.createElement('span');
    this.domContainer.className = 'tw--text-inline';
    this.domContainer.style.whiteSpace = 'pre';
    const text = textInlineBox.getChildren().map(child => {
      if (child instanceof TextAtomicBox) {
        return child.getContent();
      } else {
        throw new Error(`Invalid child AtomicBox encountered for TextInlineBox.`);
      }
    }).join('');
    this.domContainer.innerText = text;
  }

  getDOMContainer(): HTMLSpanElement {
    return this.domContainer;
  }
}
