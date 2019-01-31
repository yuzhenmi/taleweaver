/**
 * Interface for describing a transformation step for a
 * document's state.
 */
export default interface DocumentTransformationStep {
  /**
   * Gets the type of document transformation step.
   */
  getType(): string;
}
