import Block from './Block';

/**
 * Paragraph block.
 */
export default class Paragraph extends Block {
  getType(): string {
    return 'Paragraph';
  }
}
