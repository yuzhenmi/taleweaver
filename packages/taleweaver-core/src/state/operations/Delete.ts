import Operation from './Operation';

export default class Delete extends Operation {
  private from: number;
  private to: number;

  constructor(from: number, to: number) {
    super();
    this.from = from;
    this.to = to;
  }

  getType(): string {
    return 'Delete';
  }

  getFrom(): number {
    return this.from;
  }

  getTo(): number {
    return this.to;
  }
}
