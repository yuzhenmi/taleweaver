import InlineView from './InlineView';
import TextInlineBox from '../layout/TextInlineBox';
import TextAtomicBox from '../layout/TextAtomicBox';

export default class TextInlineView extends InlineView {
  protected domContainer: HTMLSpanElement;

  constructor(id: string) {
    super(id);
    this.domContainer = document.createElement('span');
    this.domContainer.className = 'tw--text-inline';
    this.domContainer.style.whiteSpace = 'pre';
  }

  getDOMContainer(): HTMLSpanElement {
    return this.domContainer;
  }

  onRender(textInlineBox: TextInlineBox) {
    const text = textInlineBox.getChildren().map(child => {
      if (child instanceof TextAtomicBox) {
        return child.getContent();
      } else {
        throw new Error(`Invalid child AtomicBox encountered for TextInlineBox.`);
      }
    }).join('');
    this.domContainer.innerText = text;
  }
}
