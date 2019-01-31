import Cursor from '../cursor/Cursor';
import CursorTransformation from './CursorTransformation';
import TranslateCursor from './cursortransformationsteps/TranslateCursor';
import TranslateCursorHead from './cursortransformationsteps/TranslateCursorHead';

/**
 * Transformer for applying transformations
 * on cursors.
 */
export default class CursorTransformer {
  /**
   * Applies a transformation on a cursor.
   * @param cursor - Cursor to apply transformation on.
   * @param transformation - Transformation to apply.
   */
  apply(cursor: Cursor, transformation: CursorTransformation) {
    const steps = transformation.getSteps();
    steps.forEach(step => {
      if (step instanceof TranslateCursor) {
        cursor.moveTo(cursor.getHead() + step.getDisplacement());
      } else if (step instanceof TranslateCursorHead) {
        cursor.moveHeadTo(cursor.getHead() + step.getDisplacement());
      } else {
        throw new Error(`Unrecognized cursor transformation step: ${step.getType()}`);
      }
    });
  }
}
