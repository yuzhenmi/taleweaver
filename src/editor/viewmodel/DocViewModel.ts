import TaleWeaver from '../TaleWeaver';
import RootNode from '../tree/RootNode';
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
}

export default DocViewModel;
