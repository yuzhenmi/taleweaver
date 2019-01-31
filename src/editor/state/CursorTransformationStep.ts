/**
 * Interface for describing a transformation step for a
 * cursor's state.
 */
export default interface CursorTransformationStep {
  /**
   * Gets the type of cursor transformation step.
   */
  getType(): string;
}
