import { TransformationStep } from '../Transformation';

/**
 * A transformation step for translating the cursor head
 * by a certain displacement.
 */
export default class TranslateHead implements TransformationStep {
  private displacement: number;

  /**
   * Create a new move cursor head transformation step.
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
