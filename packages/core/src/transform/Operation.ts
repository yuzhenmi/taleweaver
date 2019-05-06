interface OffsetAdjustment {
  at: number;
  delta: number;
}

abstract class Operation {

  abstract getOffsetAdjustment(): OffsetAdjustment;

  abstract adjustOffset(adjustments: OffsetAdjustment[]): Operation;
}

export default Operation;
export {
  OffsetAdjustment,
};
