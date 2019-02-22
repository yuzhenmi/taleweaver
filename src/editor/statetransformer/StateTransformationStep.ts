/**
 * Interface for describing a state transformation step..
 */
export default interface StateTransformationStep {
  /**
   * Gets the type of state transformation step.
   */
  getType(): string;
}
