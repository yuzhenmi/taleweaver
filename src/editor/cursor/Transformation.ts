import Operation from './operations/Operation';

export default class Transformation {
  private operations: Operation[] = [];
  private keepX: boolean;

  constructor(keepX: boolean = false) {
    this.operations = [];
    this.keepX = keepX;
  }

  addOperation(operation: Operation) {
    this.operations.push(operation);
  }

  getOperations(): Operation[] {
    return this.operations;
  }

  getKeepX(): boolean {
    return this.keepX;
  }
}
