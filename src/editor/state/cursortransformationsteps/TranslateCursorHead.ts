import CursorTransformationStep from '../CursorTransformationStep';

/**
 * A transformation step for translating the cursor head
 * by a certain displacement.
 */
export default class TranslateCursorHead implements CursorTransformationStep {
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
