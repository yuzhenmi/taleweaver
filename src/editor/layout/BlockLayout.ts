import Line from './LineLayout';
import LineLayout from './LineLayout';

export default interface BlockLayout {
  getType(): string;
  getSize(): number;
  getWidth(): number;
  getHeight(): number;
  getLineLayouts(): Line[];
  getLineLayoutAt(position: number): LineLayout | null;
}
