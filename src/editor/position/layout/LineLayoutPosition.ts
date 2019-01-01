import BlockLayoutPosition from './BlockLayoutPosition';
import LineLayout from '../../layout/LineLayout';

export default class LineLayoutPosition {
  private blockLayoutPosition: BlockLayoutPosition;
  private lineLayout: LineLayout;
  private position: number;

  constructor(blockLayoutPosition: BlockLayoutPosition, lineLayout: LineLayout, position: number) {
    this.blockLayoutPosition = blockLayoutPosition;
    this.lineLayout = lineLayout;
    this.position = position;
  }

  getBlockLayoutPosition(): BlockLayoutPosition {
    return this.blockLayoutPosition;
  }

  getLineLayout(): LineLayout {
    return this.lineLayout;
  }

  getPosition(): number {
    return this.position;
  }
}
