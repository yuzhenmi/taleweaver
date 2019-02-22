import StateTransformationStep from '../StateTransformationStep';

/**
 * A transformation step for inserting a word in
 * the document.
 */
export default class Assign implements StateTransformationStep {
  /**
   * Create a new insert transformation step.
   */
  constructor() {
  }

  getType(): string {
    return 'Insert';
  }
}
