import Operation from './Operation';

/**
 * A transformation step for translating the cursor
 * by a certain displacement. The cursor head gets
 * displaced and the anchor gets moved to the head.
 */
export default class Translate implements Operation {
  private displacement: number;

  /**
   * Create a new move cursor anchor transformation step.
   * @param displacement - Vector to displace the cursor anchor by.
   * @param preserveLineViewPosition - Whether to preserve line view position.
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
