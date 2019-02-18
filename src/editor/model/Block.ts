import TaleWeaver from '../TaleWeaver';
import Token from '../state/Token';
import BlockStartToken from '../state/BlockStartToken';
import BlockEndToken from '../state/BlockEndToken';
import InlineStartToken from '../state/InlineStartToken';
import InlineEndToken from '../state/InlineEndToken';
import BranchNode from './BranchNode';
import Doc from './Doc';
import Inline from './Inline';
import ResolvedPosition from './ResolvedPosition';

type Parent = Doc;
type Child = Inline;

interface Attributes {
  [key: string]: any;
}

export default abstract class Block extends BranchNode {
  protected taleWeaver: TaleWeaver;
  protected parent: Parent;
  protected children: Child[];
  protected attributes: Attributes;

  constructor(taleWeaver: TaleWeaver, parent: Parent, tokens: Token[]) {
    super();
    this.taleWeaver = taleWeaver;
    this.parent = parent;
    this.children = [];
    if (!(tokens[0] instanceof BlockStartToken)) {
      throw new Error(`Error building block from tokens, expecting first token to be BlockStartToken.`);
    }
    if (!(tokens[tokens.length - 1] instanceof BlockEndToken)) {
      throw new Error(`Error building block from tokens, expecting last token to be BlockEndToken.`);
    }
    const startToken = tokens[0] as BlockStartToken;
    this.attributes = startToken.getAttributes();
    let childStartOffset = 1;
    let depth = 0;
    for (let n = 1, nn = tokens.length - 1; n < nn; n++) {
      const token = tokens[n];
      if (token instanceof InlineStartToken) {
        if (depth === 0) {
          childStartOffset = n;
        }
        depth += 1;
      } else if (token instanceof InlineEndToken) {
        depth -= 1;
      }
      if (depth === 0) {
        const childTokens = tokens.slice(childStartOffset, n + 1);
        const inlineStartToken = tokens[childStartOffset] as InlineStartToken;
        const InlineClass = taleWeaver.getConfig().getInlineClass(inlineStartToken.getType());
        const inline = new InlineClass(taleWeaver, this, childTokens);
        this.appendChild(inline);
      }
    }
  }

  getSize(): number {
    let size = 1;
    this.children.forEach(child => {
      size += child.getSize();
    });
    size += 1;
    return size;
  }

  getParent(): Parent {
    return this.parent;
  }
  
  appendChild(child: Child) {
    this.children.push(child);
  }

  removeChild(child: Child) {
    const index = this.children.indexOf(child);
    if (index < 0) {
      return;
    }
    this.children.splice(index, 1);
  }

  getChildren(): Child[] {
    return this.children;
  }

  parentAt(offset: number): ResolvedPosition {
    if (offset < 0) {
      throw new Error(`Block offset out of range: ${offset}.`);
    }
    if (offset > this.getSize() - 1) {
      throw new Error(`Block offset out of range: ${offset}.`);
    }
    const parent = this.parent;
    const siblings = parent.getChildren();
    let cumulatedParentOffset = 0;
    for (let n = 0, nn = siblings.length; n < nn; n++) {
      const sibling = siblings[n];
      if (sibling === this) {
        return new ResolvedPosition(parent, cumulatedParentOffset + offset);
      }
      cumulatedParentOffset += sibling.getSize();
    }
    throw new Error(`Tree model is corrupted, block not found in parent.`);
  }

  childAt(offset: number): ResolvedPosition {
    if (offset < 0) {
      throw new Error(`Block offset out of range: ${offset}.`);
    }
    let cumulatedOffset = 0;
    for (let n = 0, nn = this.children.length; n < nn; n++) {
      const child = this.children[n];
      const childSize = child.getSize();
      if (offset < cumulatedOffset + childSize) {
        return new ResolvedPosition(child, offset - cumulatedOffset);
      }
      cumulatedOffset += childSize;
    }
    throw new Error(`Block offset out of range: ${offset}.`);
  }
}
