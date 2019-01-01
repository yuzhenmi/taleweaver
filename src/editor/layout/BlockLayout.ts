import Line from './LineLayout';

export default interface BlockLayout {
  getType(): string;
  getSize(): number;
  getWidth(): number;
  getHeight(): number;
  getLines(): Line[];
}
