import BlockBox from './BlockBox';

export default class ParagraphBlockBox extends BlockBox {

  getType(): string {
    return 'ParagraphBlockBox';
  }

  cutAt(offset: number): BlockBox {
    if (offset >= this.children.length) {
      throw new Error(`Error cutting ParagraphBlockBox, offset ${offset} is out of range.`);
    }
    const childrenCut = this.children.splice(offset);
    const childrenCutSelectableSize = childrenCut.reduce((sum, child) => sum + child.getSelectableSize(), 0);
    this.selectableSize -= childrenCutSelectableSize;
    const newParagraphBlockBox = new ParagraphBlockBox();
    childrenCut.forEach((child, childOffset) => {
      newParagraphBlockBox.insertChild(child, childOffset);
    });
    return newParagraphBlockBox;
  }
}
