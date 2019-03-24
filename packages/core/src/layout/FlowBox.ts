import LayoutNode from './LayoutNode';

export default abstract class FlowBox extends LayoutNode {

  constructor() {
    super();
  }

  abstract getWidth(): number;

  abstract getHeight(): number;
}
