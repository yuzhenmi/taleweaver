import Attributes from '../token/Attributes';
import InlineElement from './InlineElement';

export default class Text extends InlineElement {
  static compatibleHTMLTagNames: string[] = ['*'];
  static fromHTMLElement($element: HTMLElement): Text {
    throw new Error('TODO');
  }

  getType() {
    return 'Text';
  }

  getAttributes() {
    return {
      id: this.id!,
    };
  }

  toHTML(from: number, to: number) {
    const $element = document.createElement('span');
    $element.innerText = this.content.substring(from - 1, to - 1);
    return $element;
  }

  onStateUpdated(attributes: Attributes) {
    return false;
  }
}
