import CursorTransformationStep from '../CursorTransformationStep';

/**
 * A transformation step for translating the cursor
 * by a certain displacement. The cursor head gets
 * displaced and the anchor gets moved to the head.
 */
export default class TranslateCursor implements CursorTransformationStep {
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
