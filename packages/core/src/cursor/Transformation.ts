import Operation from './Operation';

export default class Transformation {
  protected operations: Operation[] = [];
  protected leftAnchor: number | null;

  constructor() {
    this.operations = [];
    this.leftAnchor = null;
  }

  addOperation(operation: Operation) {
    this.operations.push(operation);
  }

  getOperations(): Operation[] {
    return this.operations;
  }

  setLeftAnchor(leftAnchor: number) {
    this.leftAnchor = leftAnchor;
  }

  getLeftAnchor(): number | null {
    return this.leftAnchor;
  }
}
