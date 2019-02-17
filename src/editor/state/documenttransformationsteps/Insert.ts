import DocumentTransformationStep from '../DocumentTransformationStep';

/**
 * A transformation step for inserting a word in
 * the document.
 */
export default class Assign implements DocumentTransformationStep {
  /**
   * Create a new insert transformation step.
   */
  constructor() {
  }

  getType(): string {
    return 'Insert';
  }
}
