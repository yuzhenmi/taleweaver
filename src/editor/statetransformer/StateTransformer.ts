import State from '../state/State';
import StateTransformation from './StateTransformation';
import Assign from './steps/Assign';

/**
 * Transformer for applying state transformations.
 */
export default class StateTransformer {
  /**
   * Applies a transformation on the document state.
   * @param doc - Document state to apply transformation on.
   * @param transformation - Transformation to apply.
   */
  apply(state: State, transformation: StateTransformation) {
    const steps = transformation.getSteps();
    steps.forEach(step => {
      if (step instanceof Assign) {
        // TODO
      } else {
        throw new Error(`Unrecognized document transformation step: ${step.getType()}`);
      }
    });
  }
}
