import BlockElement from '../BlockElement';

/**
 * Paragraph block element.
 */
export default class ParagraphElement extends BlockElement {
  getType(): string {
    return 'Paragraph';
  }
}
