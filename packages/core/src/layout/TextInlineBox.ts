import TextInlineRenderNode from '../render/TextInlineRenderNode';
import InlineBox from './InlineBox';
import TextAtomicBox from './TextAtomicBox';
import TextAtomicRenderNode from '../render/TextAtomicRenderNode';

export default class TextInlineBox extends InlineBox {

  getType(): string {
    return 'TextInlineBox';
  }

  onRenderUpdated(renderNode: TextInlineRenderNode) {
    super.onRenderUpdated(renderNode);
    this.children = [];
    renderNode.getChildren().forEach((child, childOffset) => {
      if (!(child instanceof TextAtomicRenderNode)) {
        throw new Error('Expecting child of TextInlineRenderNode to be AtomicInlineRenderNode.');
      }
      const textAtomicBox = new TextAtomicBox(child.getID());
      this.insertChild(textAtomicBox, childOffset);
      textAtomicBox.onRenderUpdated(child);
    });
  }

  splitAt(offset: number): InlineBox {
    if (offset > this.children.length) {
      throw new Error(`Error cleaving TextInlineBox, offset ${offset} is out of range.`);
    }
    const childrenCut = this.children.splice(offset);
    const newTextInlineBox = new TextInlineBox(this.renderNodeID);
    childrenCut.forEach((child, childOffset) => {
      newTextInlineBox.insertChild(child, childOffset);
    });
    this.width = undefined;
    this.height = undefined;
    this.selectableSize = undefined;
    return newTextInlineBox;
  }

  join(textInlineBox: TextInlineBox) {
    if (textInlineBox.getRenderNodeID() !== this.renderNodeID) {
      throw new Error('Cannot join inline boxes with different render node IDs.');
    }
    let childOffset = this.children.length;
    textInlineBox.getChildren().forEach(child => {
      this.insertChild(child, childOffset);
      childOffset++;
    });
    this.height = undefined;
    this.selectableSize = undefined;
  }
}
