import LineLayoutPosition from './LineLayoutPosition';
import BoxLayout from '../../layout/BoxLayout';

export default class BlockLayoutPosition {
  private lineLayoutPosition: LineLayoutPosition;
  private boxLayout: BoxLayout;
  private position: number;

  constructor(lineLayoutPosition: LineLayoutPosition, boxLayout: BoxLayout, position: number) {
    this.lineLayoutPosition = lineLayoutPosition;
    this.boxLayout = boxLayout;
    this.position = position;
  }

  getLineLayoutPosition(): LineLayoutPosition {
    return this.lineLayoutPosition;
  }

  getBoxLayout(): BoxLayout {
    return this.boxLayout;
  }

  getPosition(): number {
    return this.position;
  }
}
