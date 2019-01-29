import BlockElement from '../BlockElement';

export default class ParagraphElement extends BlockElement {
  getType(): string {
    return 'Paragraph';
  }
}
