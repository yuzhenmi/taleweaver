import TextInlineRenderNode from '../render/TextInlineRenderNode';
import InlineBox from './InlineBox';
import TextAtomicBox from './TextAtomicBox';
import TextAtomicRenderNode from '../render/TextAtomicRenderNode';

export default class TextInlineBox extends InlineBox {

  getType(): string {
    return 'TextInlineBox';
  }

  onRenderUpdated(renderNode: TextInlineRenderNode) {
    this.children = [];
    renderNode.getChildren().forEach((child, childOffset) => {
      if (!(child instanceof TextAtomicRenderNode)) {
        throw new Error('Expecting child of TextInlineRenderNode to be AtomicInlineRenderNode.');
      }
      const textAtomicBox = new TextAtomicBox(child.getID());
      this.insertChild(textAtomicBox, childOffset);
      textAtomicBox.onRenderUpdated(child);
    });
    this.width = undefined;
    this.height = undefined;
    this.selectableSize = undefined;
  }

  cleaveAt(offset: number): InlineBox {
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
}
