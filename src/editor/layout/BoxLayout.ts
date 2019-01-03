import LineLayout from "./LineLayout";

export default interface BoxLayout {
  getType(): string;
  getSize(): number;
  getLineLayout(): LineLayout;
  getWidth(): number;
  getHeight(): number;
  getWidthBetween(from: number, to: number): number;
}
