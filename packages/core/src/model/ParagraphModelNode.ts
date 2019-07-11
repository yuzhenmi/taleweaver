import Editor from '../Editor';
import { Attributes } from '../state/OpenTagToken';
import BlockModelNode from './BlockModelNode';
import { DOMAttributes } from './ModelNode';

interface ParagraphAttributes extends Attributes { }

export default class ParagraphModelNode extends BlockModelNode<ParagraphAttributes> {

  static getDOMNodeNames(): string[] {
    return [
      'P',
      'DIV',
    ];
  }

  static fromDOM(editor: Editor, nodeName: string, attributes: DOMAttributes): ParagraphModelNode | null {
    return new ParagraphModelNode(editor, {});
  }

  getType() {
    return 'Paragraph';
  }

  toHTML(from: number, to: number) {
    const $element = document.createElement('p');
    let offset = 1;
    for (let n = 0, nn = this.children!.length; n < nn && offset < to; n++) {
      const child = this.children![n];
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
}
