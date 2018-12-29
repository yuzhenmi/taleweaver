export default class Cursor {
  private anchor: number;
  private head: number;

  constructor(anchor: number, head: number) {
    this.anchor = anchor;
    this.head = head;
  }

  getAnchor(): number {
    return this.anchor;
  }

  setAnchor(anchor: number) {
    this.anchor = anchor;
  }

  getHead(): number {
    return this.head;
  }

  setHead(head: number) {
    this.head = head;
  }
}
