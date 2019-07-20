import InlineNode from './InlineLayoutNode';

export default class LineBreakLayoutNode extends InlineNode {

  getType() {
    return 'LineBreak';
  }

  getPaddingTop() {
    return 0;
  }

  getPaddingBottom() {
    return 0;
  }

  splitAt(offset: number): LineBreakLayoutNode {
    throw new Error('Cannot split line break inline box.');
  }

  join(node: LineBreakLayoutNode) {
    throw new Error('Cannot join line break inline boxes.');
  }
}
