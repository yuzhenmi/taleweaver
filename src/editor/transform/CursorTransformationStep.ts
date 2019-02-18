import { CursorTransformationExtraArgs } from '../cursor/Cursor';

/**
 * Interface for describing a transformation step for a
 * cursor's state.
 */
export default interface CursorTransformationStep {
  /**
   * Gets the type of cursor transformation step.
   */
  getType(): string;

  /**
   * Gets extra args for this transformation step.
   * The args are passed to cursor state transformation
   * observers.
   */
  getExtraArgs(): CursorTransformationExtraArgs;
}
