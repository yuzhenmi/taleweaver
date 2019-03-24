import LayoutNode from './LayoutNode';

export default abstract class FlowBox extends LayoutNode {
  protected width: number;
  protected height: number;

  constructor(selectableSize: number, width: number, height: number) {
    super(selectableSize);
    this.width = width;
    this.height = height;
  }

  getSelectableSize(): number {
    return this.selectableSize;
  }

  getWidth(): number {
    return this.width;
  }

  getHeight(): number {
    return this.height;
  }
}
