import TaleWeaver from '../TaleWeaver';
import BranchNode from '../tree/BranchNode';
import Block from '../model/Block';
import DocViewModel from './DocViewModel';
import WordViewModel from './WordViewModel';

type Parent = DocViewModel;
type Child = WordViewModel;

class BlockViewModel extends BranchNode {
  protected taleWeaver: TaleWeaver;
  protected block: Block;
  protected parent: Parent;
  protected children: Child[];

  constructor(taleWeaver: TaleWeaver, block: Block, parent: Parent) {
    super();
    this.taleWeaver = taleWeaver;
    this.block = block;
    this.parent = parent;
    this.children = [];
    const wordViewModelClasses = new Set();
    block.getChildren().forEach(inline => {
      const wordViewModelClass = taleWeaver.getConfig().getWordViewModelClass(inline.getType());
      wordViewModelClasses.add(wordViewModelClass);
      // @ts-ignore
      const wordViewModels: WordViewModel[] = wordViewModelClass.fromInline(taleWeaver, inline, this);
      this.children.push(...wordViewModels);
    });
    wordViewModelClasses.forEach(wordViewModelClass => {
      this.children = wordViewModelClass.postProcess(taleWeaver, this.children, this);
    });
  }

  getType(): string {
    return this.block.getType();
  }
  
  getSize(): number {
    return this.block.getSize();
  }

  getParent(): Parent {
    return this.parent;
  }

  getChildren(): Child[] {
    return this.children;
  }
}

export default BlockViewModel;
