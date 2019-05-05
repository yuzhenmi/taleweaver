import Operation from './Operation';

export default class Transformation {
  protected operations: Operation[] = [];
  protected cursorHead: number | null = null;
  protected cursorAnchor: number | null = null;
  protected cursorLockLeft: number | null = null;

  addOperation(operation: Operation) {
    this.operations.push(operation);
  }

  getOperations() {
    return this.operations;
  }

  setCursorHead(cursorHead: number) {
    this.cursorHead = cursorHead;
  }

  getCursorHead() {
    return this.cursorHead;
  }

  setCursor(at: number) {
    this.cursorAnchor = at;
    this.cursorHead = at;
  }

  getCursorAnchor() {
    return this.cursorAnchor;
  }

  setCursorLockLeft(cursorLockLeft: number) {
    this.cursorLockLeft = cursorLockLeft;
  }

  getCursorLockLeft() {
    return this.cursorLockLeft;
  }
}
