import DocumentElement from '../model/DocumentElement';
import DocumentTransformation from './DocumentTransformation';

/**
 * Transformer for applying transformations
 * on cursors.
 */
export default class DocumentTransformer {
  /**
   * Applies a transformation on a document element.
   * @param document - Document to apply transformation on.
   * @param transformation - Transformation to apply.
   */
  apply(documentElement: DocumentElement, transformation: DocumentTransformation) {
    const steps = transformation.getSteps();
    steps.forEach(step => {
      // if (step instanceof TranslateCursor) {
      //   cursor.moveTo(cursor.getHead() + step.getDisplacement());
      // } else if (step instanceof TranslateCursorHead) {
      //   cursor.moveHeadTo(cursor.getHead() + step.getDisplacement());
      // } else {
      //   throw new Error(`Unrecognized cursor transformation step: ${step.getType()}`);
      // }
    });
  }
}
