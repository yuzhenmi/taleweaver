import Cursor from '../cursor/Cursor';
import CursorStateTransformation, { TranslateCursor, TranslateCursorHead } from './CursorStateTransformation';

/**
 * Processes transformations on a cursor.
 */
export default class CursorStateTransformer {
  private cursor: Cursor;

  constructor(cursor: Cursor) {
    this.cursor = cursor;
  }

  /**
   * Applies a transformation.
   * @param transformation - Transformation to apply.
   */
  apply(transformation: CursorStateTransformation) {
    const steps = transformation.getSteps();
    steps.forEach(step => {
      if (step instanceof TranslateCursor) {
        this.cursor.set(this.cursor.getHead() + step.getDisplacement());
      } else if (step instanceof TranslateCursorHead) {
        this.cursor.setHead(this.cursor.getHead() + step.getDisplacement());
      }
    });
  }
}
