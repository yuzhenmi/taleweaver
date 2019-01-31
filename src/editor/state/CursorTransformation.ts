import CursorTransformationStep from './CursorTransformationStep';

/**
 * Describes a cursor transformation as a series
 * of steps.
 */
export default class CursorTransformation {
  private steps: CursorTransformationStep[] = [];

  /**
   * Create a new cursor transformation.
   */
  constructor() {
    this.steps = [];
  }

  /**
   * Add a step to the transformation.
   */
  addStep(step: CursorTransformationStep) {
    this.steps.push(step);
  }

  /**
   * Get all steps of the transformation.
   */
  getSteps(): CursorTransformationStep[] {
    return this.steps;
  }
}
