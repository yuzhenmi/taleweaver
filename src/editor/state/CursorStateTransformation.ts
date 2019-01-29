/**
 * Interface for describing a transformation step for a
 * cursor's state.
 */
export interface CursorStateTransformationStep {}

/**
 * A transformation step for translating the cursor
 * by a certain displacement. The cursor head gets
 * displaced and the anchor gets moved to the head.
 */
export class TranslateCursor implements CursorStateTransformationStep {
  private displacement: number;

  /**
   * Create a new translate cursor anchor transformation step.
   * @param displacement - Vector to displace the cursor anchor by.
   */
  constructor(displacement: number) {
    this.displacement = displacement;
  }

  /**
   * Get displacement vector.
   */
  getDisplacement(): number {
    return this.displacement;
  }
}

/**
 * A transformation step for translating the cursor head
 * by a certain displacement.
 */
export class TranslateCursorHead implements CursorStateTransformationStep {
  private displacement: number;

  /**
   * Create a new translate cursor head transformation step.
   * @param displacement - Vector to displace the cursor head by.
   */
  constructor(displacement: number) {
    this.displacement = displacement;
  }

  /**
   * Get displacement vector.
   */
  getDisplacement(): number {
    return this.displacement;
  }
}

/**
 * Describes a cursor state transformation as a series
 * of steps.
 */
export default class CursorStateTransformation {
  private steps: CursorStateTransformationStep[] = [];

  /**
   * Create a new cursor state transformation.
   */
  constructor() {
    this.steps = [];
  }

  /**
   * Add a step to the transformation.
   */
  addStep(step: CursorStateTransformationStep) {
    this.steps.push(step);
  }

  /**
   * Get all steps of the transformation.
   */
  getSteps(): CursorStateTransformationStep[] {
    return this.steps;
  }
}
