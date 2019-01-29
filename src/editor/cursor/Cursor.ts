type CursorObserver = (cursor: Cursor) => void;

export default class Cursor {
  private anchor: number;
  private head: number;
  private observers: CursorObserver[];

  constructor(anchor: number, head: number) {
    this.anchor = anchor;
    this.head = head;
    this.observers = [];
  }

  private notify() {
    this.observers.forEach(observer => {
      observer(this);
    });
  }

  observe(observer: CursorObserver) {
    this.observers.push(observer);
  }

  set(position: number) {
    this.anchor = position;
    this.head = position;
    this.notify();
  }

  setHead(position: number) {
    this.head = position;
    this.notify();
  }

  getAnchor(): number {
    return this.anchor!;
  }

  getHead(): number {
    return this.head!;
  }
}
