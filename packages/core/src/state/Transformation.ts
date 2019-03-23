import Operation from './Operation';

export default class Transformation {
  protected operations: Operation[] = [];

  constructor() {
    this.operations = [];
  }

  addOperation(operation: Operation) {
    this.operations.push(operation);
  }

  getOperations(): Operation[] {
    return this.operations;
  }
}
