import DocumentTransformationStep from '../DocumentTransformationStep';

/**
 * A transformation step for assigning content
 * to a word in the document.
 */
export default class Assign implements DocumentTransformationStep {
  private text: string;

  /**
   * Create a new assign document transformation step.
   * @param text - Text to assign to the inline element.
   */
  constructor(text: string) {
    this.text = text;
  }

  getType(): string {
    return 'Assign';
  }

  getText(): string {
    return this.text;
  }
}
