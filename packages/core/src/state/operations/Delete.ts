import Operation from '../Operation';

export default class Delete extends Operation {
  protected from: number;
  protected to: number;

  constructor(from: number, to: number) {
    super();
    this.from = from;
    this.to = to;
  }

  getDelta(): number {
    return this.from - this.to;
  }

  offsetBy(delta: number) {
    this.from += delta;
    this.to += delta;
  }

  getFrom(): number {
    return this.from;
  }

  getTo(): number {
    return this.to;
  }
}
