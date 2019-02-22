import StateTransformationStep from './StateTransformationStep';

/**
 * Describes a state transformation as a series
 * of steps.
 */
export default class StateTransformation {
  private steps: StateTransformationStep[] = [];

  /**
   * Create a new state transformation.
   */
  constructor() {
    this.steps = [];
  }

  /**
   * Add a step to the transformation.
   */
  addStep(step: StateTransformationStep) {
    this.steps.push(step);
  }

  /**
   * Get all steps of the transformation.
   */
  getSteps(): StateTransformationStep[] {
    return this.steps;
  }
}
