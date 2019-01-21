import InlineElement from './InlineElement';

export default class TextElement extends InlineElement {
  getType(): string {
    return 'Text';
  }

  getSize(): number {
    return 1;
  }
}
