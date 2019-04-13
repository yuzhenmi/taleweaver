export interface OffsetAdjustment {
  at: number;
  delta: number;
}

export default abstract class Operation {

  abstract getOffsetAdjustment(): OffsetAdjustment;

  abstract adjustOffsetBy(offsetAdjustment: OffsetAdjustment): void;
}
