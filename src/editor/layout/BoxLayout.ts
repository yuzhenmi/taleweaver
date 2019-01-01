export default interface BoxLayout {
  getType(): string;
  getSize(): number;
  getWidth(): number;
  getHeight(): number;
  getWidthBetween(from: number, to: number): number;
}
