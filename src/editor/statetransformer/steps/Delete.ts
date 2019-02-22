import StateTransformationStep from '../StateTransformationStep';

/**
 * A transformation step for deleting a word in
 * the document.
 */
export default class Delete implements StateTransformationStep {
  /**
   * Create a new delete transformation step.
   */
  constructor() {
  }

  getType(): string {
    return 'Delete';
  }
}
