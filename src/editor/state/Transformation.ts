import Operation from './operations/Operation';

export default class Transformation {
  private operations: Operation[] = [];

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
