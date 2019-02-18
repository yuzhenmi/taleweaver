import CursorTransformationStep from '../CursorTransformationStep';
import { CursorTransformationExtraArgs } from '../../cursor/Cursor';

/**
 * A transformation step for translating the cursor head
 * by a certain displacement.
 */
export default class TranslateCursorHead implements CursorTransformationStep {
  private displacement: number;
  private preserveLineViewPosition: boolean;

  /**
   * Create a new move cursor head transformation step.
   * @param displacement - Vector to displace the cursor head by.
   * @param preserveLineViewPosition - Whether to preserve line view position.
   */
  constructor(displacement: number, preserveLineViewPosition: boolean = false) {
    this.displacement = displacement;
    this.preserveLineViewPosition = preserveLineViewPosition;
  }

  getType(): string {
    return 'TranslateCursorHead';
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
