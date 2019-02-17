import TaleWeaver from '../TaleWeaver';
import Block from '../treemodel/Block';
import DocViewModel from './DocViewModel';
import WordViewModel from './WordViewModel';

type Child = WordViewModel;

class BlockViewModel {
  protected taleWeaver: TaleWeaver;
  protected docViewModel: DocViewModel;
  protected block: Block;
  protected children: Child[];

  constructor(taleWeaver: TaleWeaver, docViewModel: DocViewModel, block: Block) {
    this.taleWeaver = taleWeaver;
    this.docViewModel = docViewModel;
    this.block = block;
    this.children = [];
    const wordViewModelClasses = new Set();
    block.getChildren().forEach(inline => {
      const wordViewModelClass = taleWeaver.getConfig().getWordViewModelClass(inline.getType());
      wordViewModelClasses.add(wordViewModelClass);
      // @ts-ignore
      const wordViewModels: WordViewModel[] = wordViewModelClass.fromInline(taleWeaver, this, inline);
      this.children.push(...wordViewModels);
    });
    wordViewModelClasses.forEach(wordViewModelClass => {
      this.children = wordViewModelClass.merge(taleWeaver, this, this.children);
    });
  }

  getType(): string {
    return this.block.getType();
  }
  
  getSize(): number {
    return this.block.getSize();
  }

  getChildren(): Child[] {
    return this.children;
  }
}

export default BlockViewModel;
