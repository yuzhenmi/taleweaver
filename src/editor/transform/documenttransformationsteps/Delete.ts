import DocumentTransformationStep from '../DocumentTransformationStep';

/**
 * A transformation step for deleting a word in
 * the document.
 */
export default class Delete implements DocumentTransformationStep {
  /**
   * Create a new delete transformation step.
   */
  constructor() {
  }

  getType(): string {
    return 'Delete';
  }
}
