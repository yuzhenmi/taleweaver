import CursorTransformationStep from '../CursorTransformationStep';
import { CursorTransformationExtraArgs } from '../../cursor/Cursor';

/**
 * A transformation step for translating the cursor
 * by a certain displacement. The cursor head gets
 * displaced and the anchor gets moved to the head.
 */
export default class TranslateCursor implements CursorTransformationStep {
  private displacement: number;
  private preserveLineViewPosition: boolean;

  /**
   * Create a new move cursor anchor transformation step.
   * @param displacement - Vector to displace the cursor anchor by.
   * @param preserveLineViewPosition - Whether to preserve line view position.
   */
  constructor(displacement: number, preserveLineViewPosition: boolean = false) {
    this.displacement = displacement;
    this.preserveLineViewPosition = preserveLineViewPosition;
  }

  getType(): string {
    return 'TranslateCursor';
  }

  getExtraArgs(): CursorTransformationExtraArgs {
    return { preserveLineViewPosition: this.preserveLineViewPosition };
  }

  /**
   * Get displacement vector.
   */
  getDisplacement(): number {
    return this.displacement;
  }
}
