import Cursor from '../cursor/Cursor';

/**
 * Interface for describing a transformation step for a
 * cursor's state.
 */
export interface CursorTransformationStep {
  /**
   * Gets the type of cursor transformation step.
   */
  getType(): string;
}

/**
 * A transformation step for translating the cursor
 * by a certain displacement. The cursor head gets
 * displaced and the anchor gets moved to the head.
 */
export class TranslateCursor implements CursorTransformationStep {
  private displacement: number;

  /**
   * Create a new translate cursor anchor transformation step.
   * @param displacement - Vector to displace the cursor anchor by.
   */
  constructor(displacement: number) {
    this.displacement = displacement;
  }

  getType(): string {
    return 'TranslateCursor';
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
export class TranslateCursorHead implements CursorTransformationStep {
  private displacement: number;

  /**
   * Create a new translate cursor head transformation step.
   * @param displacement - Vector to displace the cursor head by.
   */
  constructor(displacement: number) {
    this.displacement = displacement;
  }

  getType(): string {
    return 'TranslateCursorHead';
  }

  /**
   * Get displacement vector.
   */
  getDisplacement(): number {
    return this.displacement;
  }
}

/**
 * Describes a cursor transformation as a series
 * of steps.
 */
export class CursorTransformation {
  private steps: CursorTransformationStep[] = [];

  /**
   * Create a new cursor transformation.
   */
  constructor() {
    this.steps = [];
  }

  /**
   * Add a step to the transformation.
   */
  addStep(step: CursorTransformationStep) {
    this.steps.push(step);
  }

  /**
   * Get all steps of the transformation.
   */
  getSteps(): CursorTransformationStep[] {
    return this.steps;
  }
}

/**
 * Transformer for applying transformations
 * on cursors.
 */
export default class CursorTransformer {
  /**
   * Applies a transformation on a cursor.
   * @param cursor - Cursor to apply transformation on.
   * @param transformation - Transformation to apply.
   */
  apply(cursor: Cursor, transformation: CursorTransformation) {
    const steps = transformation.getSteps();
    steps.forEach(step => {
      if (step instanceof TranslateCursor) {
        cursor.moveTo(cursor.getHead() + step.getDisplacement());
      } else if (step instanceof TranslateCursorHead) {
        cursor.moveHeadTo(cursor.getHead() + step.getDisplacement());
      } else {
        throw new Error(`Unrecognized cursor transformation step: ${step.getType()}`);
      }
    });
  }
}
