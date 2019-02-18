import DocumentTransformationStep from './DocumentTransformationStep';

/**
 * Describes a document transformation as a series
 * of steps.
 */
export default class DocumentTransformation {
  private steps: DocumentTransformationStep[] = [];

  /**
   * Create a new document transformation.
   */
  constructor() {
    this.steps = [];
  }

  /**
   * Add a step to the transformation.
   */
  addStep(step: DocumentTransformationStep) {
    this.steps.push(step);
  }

  /**
   * Get all steps of the transformation.
   */
  getSteps(): DocumentTransformationStep[] {
    return this.steps;
  }
}
