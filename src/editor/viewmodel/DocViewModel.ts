import TaleWeaver from '../TaleWeaver';
import RootNode from '../tree/RootNode';
import TreePosition from '../tree/TreePosition';
import Doc from '../model/Doc';
import BlockViewModel from './BlockViewModel';

type Child = BlockViewModel;

class DocViewModel extends RootNode {
  static getType(): string {
    return 'Doc';
  }

  protected taleWeaver: TaleWeaver;
  protected doc: Doc;
  protected children: Child[];

  constructor(taleWeaver: TaleWeaver, doc: Doc) {
    super();
    this.taleWeaver = taleWeaver;
    this.doc = doc;
    this.children = doc.getChildren().map(block => {
      const blockViewModel = new BlockViewModel(taleWeaver, block, this);
      return blockViewModel;
    });
  }

  getType(): string {
    return DocViewModel.getType();
  }

  getSize(): number {
    return this.doc.getSize();
  }

  getChildren(): Child[] {
    return this.children;
  }

  childAt(offset: number): TreePosition {
    if (offset < 1) {
      throw new Error(`Doc view offset out of range: ${offset}`);
    }
    let cumulatedOffset = 1;
    for (let n = 0, nn = this.children.length; n < nn; n++) {
      const child = this.children[n];
      const childSize = child.getSize();
      if (offset < cumulatedOffset + childSize) {
        return new TreePosition(child, offset - cumulatedOffset);
      }
      cumulatedOffset += childSize;
    }
    throw new Error(`Doc view offset out of range: ${offset}`);
  }
}

export default DocViewModel;
