import Attributes from '../token/Attributes';
import BlockElement from './BlockElement';

export default class Paragraph extends BlockElement {
  static compatibleHTMLTagNames: string[] = ['*'];
  static fromHTMLElement($element: HTMLElement): Paragraph {
    throw new Error('TODO');
  }

  getType() {
    return 'Paragraph';
  }

  getAttributes() {
    return {
      id: this.id!,
    };
  }

  toHTML(from: number, to: number) {
    const $element = document.createElement('p');
    let offset = 1;
    for (let n = 0, nn = this.children.length; n < nn && offset < to; n++) {
      const child = this.children[n];
      const childSize = child.getSize();
      const childFrom = Math.max(0, from - offset);
      const childTo = Math.min(childFrom + childSize, to - offset);
      offset += childSize;
      if (childFrom > childSize || childTo < 0) {
        continue;
      }
      const $childElement = child.toHTML(childFrom, childTo);
      $element.appendChild($childElement);
    }
    return $element;
  }

  onStateUpdated(attributes: Attributes) {
    return false;
  }
}
