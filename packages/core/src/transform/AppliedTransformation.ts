import Transformation from './Transformation';
import AppliedOperation from './AppliedOperation';

class AppliedTransformation {
  protected originalTransformation: Transformation;
  protected operations: AppliedOperation[] = [];
  protected originalCursorHead: number;
  protected originalCursorAnchor: number;
  protected originalCursorLockLeft: number | null;

  constructor(
    originalTransformation: Transformation,
    originalCursorHead: number,
    originalCursorAnchor: number,
    originalCursorLockLeft: number | null,
  ) {
    this.originalTransformation = originalTransformation;
    this.originalCursorHead = originalCursorHead;
    this.originalCursorAnchor = originalCursorAnchor;
    this.originalCursorLockLeft = originalCursorLockLeft;
  }

  addOperation(operation: AppliedOperation) {
    this.operations.push(operation);
  }

  getOperations() {
    return this.operations;
  }

  getOriginalTransformation() {
    return this.originalTransformation;
  }

  getOriginalCursorHead() {
    return this.originalCursorHead;
  }

  getOriginalCursorAnchor() {
    return this.originalCursorAnchor;
  }

  getOriginalCursorLockLeft() {
    return this.originalCursorLockLeft;
  }
}

export default AppliedTransformation;
