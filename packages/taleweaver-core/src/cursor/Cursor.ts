export default class Cursor {
  protected anchor: number;
  protected head: number;

  constructor(anchor: number, head: number) {
    this.anchor = anchor;
    this.head = head;
  }

  getAnchor(): number {
    return this.anchor;
  }

  getHead(): number {
    return this.head;
  }

  setAnchor(anchor: number) {
    this.anchor = anchor;
  }

  setHead(head: number) {
    this.head = head;
  }
}
