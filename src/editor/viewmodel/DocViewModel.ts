import TaleWeaver from '../TaleWeaver';
import Doc from '../treemodel/Doc';
import BlockViewModel from './BlockViewModel';

type Child = BlockViewModel;

class DocViewModel {
  protected taleWeaver: TaleWeaver;
  protected doc: Doc;
  protected children: Child[];

  constructor(taleWeaver: TaleWeaver, doc: Doc) {
    this.taleWeaver = taleWeaver;
    this.doc = doc;
    this.children = doc.getChildren().map(block => {
      const blockViewModel = new BlockViewModel(taleWeaver, this, block);
      return blockViewModel;
    });
  }

  getSize(): number {
    return this.doc.getSize();
  }

  getChildren(): Child[] {
    return this.children;
  }
}

export default DocViewModel;
