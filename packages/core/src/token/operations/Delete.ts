import Operation, { OffsetAdjustment } from '../Operation';

export default class Delete extends Operation {
  protected from: number;
  protected to: number;

  constructor(from: number, to: number) {
    super();
    this.from = from;
    this.to = to;
  }

  getOffsetAdjustment(): OffsetAdjustment {
    return {
      at: this.to,
      delta: this.from - this.to,
    };
  }

  adjustOffsetBy(offsetAdjustment: OffsetAdjustment) {
    if (this.from >= offsetAdjustment.at) {
      this.from += offsetAdjustment.delta;
    }
    if (this.to >= offsetAdjustment.at) {
      this.to += offsetAdjustment.delta;
    }
  }

  getFrom(): number {
    return this.from;
  }

  getTo(): number {
    return this.to;
  }
}
