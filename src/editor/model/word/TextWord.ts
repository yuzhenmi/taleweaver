import Word from '../Word';

/**
 * Word for text elements.
 */
export default class TextWord extends Word {
  getType(): string {
    return 'Text';
  }
}
