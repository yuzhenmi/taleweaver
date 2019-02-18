import Doc from '../treemodel/Doc';
import DocumentTransformation from './DocumentTransformation';
import Assign from './documenttransformationsteps/Assign';

/**
 * Transformer for applying transformations
 * on the document.
 */
export default class DocumentTransformer {
  /**
   * Applies a transformation on a document element.
   * @param doc - Document element to apply transformation on.
   * @param transformation - Transformation to apply.
   */
  apply(doc: Doc, transformation: DocumentTransformation) {
    const steps = transformation.getSteps();
    steps.forEach(step => {
      if (step instanceof Assign) {
        doc.getChildren()[0].getChildren()[0].setContent(step.getText());
      } else {
        throw new Error(`Unrecognized document transformation step: ${step.getType()}`);
      }
    });
  }
}
