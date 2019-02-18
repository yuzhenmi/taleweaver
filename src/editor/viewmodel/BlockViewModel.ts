import TaleWeaver from '../TaleWeaver';
import Node from '../tree/Node';
import BranchNode from '../tree/BranchNode';
import TreePosition from '../tree/TreePosition';
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

  getPreviousSibling(): Node | null {
    const siblings = this.parent.getChildren();
    let index = siblings.indexOf(this);
    if (index < 0) {
      throw new Error(`Model is corrupted, block not found in parent.`);
    }
    if (index === 0) {
      return null;
    }
    return siblings[index - 1];
  }

  getNextSibling(): Node | null {
    const siblings = this.parent.getChildren();
    let index = siblings.indexOf(this);
    if (index < 0) {
      throw new Error(`Model is corrupted, block not found in parent.`);
    }
    if (index === siblings.length - 1) {
      return null;
    }
    return siblings[index + 1];
  }

  getChildren(): Child[] {
    return this.children;
  }

  parentAt(offset: number): TreePosition {
    if (offset < 0) {
      throw new Error(`Block view offset out of range: ${offset}.`);
    }
    if (offset > this.getSize() - 1) {
      throw new Error(`Block view offset out of range: ${offset}.`);
    }
    const parent = this.parent;
    const siblings = parent.getChildren();
    let cumulatedParentOffset = 1;
    for (let n = 0, nn = siblings.length; n < nn; n++) {
      const sibling = siblings[n];
      if (sibling === this) {
        return new TreePosition(parent, cumulatedParentOffset + offset);
      }
      cumulatedParentOffset += sibling.getSize();
    }
    throw new Error(`View model is corrupted, block view not found in parent.`);
  }

  childAt(offset: number): TreePosition {
    if (offset < 1) {
      throw new Error(`Block view offset out of range: ${offset}`);
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
    throw new Error(`Block view offset out of range: ${offset}`);
  }
}

export default BlockViewModel;
