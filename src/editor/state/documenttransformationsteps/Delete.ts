import DocumentTransformationStep from '../DocumentTransformationStep';

/**
 * A transformation step for assigning content
 * to an inline element in the document.
 */
export default class Delete implements DocumentTransformationStep {
  private displacement: number;
  private preserveLineViewPosition: boolean;

  /**
   * Create a new move cursor anchor transformation step.
   * @param displacement - Vector to displace the cursor anchor by.
   * @param preserveLineViewPosition - Whether to preserve line view position.
   */
  constructor(displacement: number, preserveLineViewPosition: boolean = false) {
  }

  getType(): string {
    return 'Delete';
  }
}
