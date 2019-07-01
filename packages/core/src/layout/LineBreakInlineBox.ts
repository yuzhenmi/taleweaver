import LineBreakInlineRenderNode from '../render/LineBreakInlineRenderNode';
import InlineBox from './InlineBox';

export default class LineBreakInlineBox extends InlineBox {

  getType() {
    return 'LineBreakInlineBox';
  }

  splitAt(offset: number): LineBreakInlineBox {
    throw new Error('Cannot split line break inline box.');
  }

  join(inlineBox: LineBreakInlineBox) {
    throw new Error('Cannot join line break inline boxes.');
  }

  onRenderUpdated(renderNode: LineBreakInlineRenderNode) {
    super.onRenderUpdated(renderNode);
  }
}
