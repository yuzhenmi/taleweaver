import Editor from '../Editor';
import Attributes from '../token/Attributes';
import { DOMAttributes } from './Element';
import InlineElement from './InlineElement';

export default class Text extends InlineElement {

  static getDOMNodeNames(): string[] {
    return [
      'SPAN',
    ];
  }

  static fromDOM(editor: Editor, nodeName: string, attributes: DOMAttributes, content: string): InlineElement | null {
    const text = new Text(editor);
    text.setContent(content);
    return text;
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
