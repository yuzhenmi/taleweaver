import TaleWeaver from '../TaleWeaver';
import Token from '../state/Token';
import BlockStartToken from '../state/BlockStartToken';
import BlockEndToken from '../state/BlockEndToken';
import BranchNode from './BranchNode';
import Doc from './Doc';
import Inline from './Inline';
import splitTokens from './helpers/splitTokens';

type Parent = Doc;
type Child = Inline;

export default abstract class Block extends BranchNode {
  protected taleWeaver: TaleWeaver;
  protected tokens: Token[];
  protected id: string;
  protected parent: Parent;
  protected children: Child[];

  constructor(taleWeaver: TaleWeaver, parent: Parent, tokens: Token[]) {
    super();
    this.taleWeaver = taleWeaver;
    this.tokens = tokens;
    this.parent = parent;
    this.children = [];
    this.validateTokens(tokens);
    const startToken = tokens[0] as BlockStartToken;
    const { id } = startToken.getAttributes();
    this.id = id;
    this.updateFromTokens(tokens);
  }

  getID(): string {
    return this.id;
  }

  getSize(): number {
    let size = 2;
    this.children.forEach(child => {
      size += child.getSize();
    });
    return size;
  }

  getSelectableSize(): number {
    let size = 0;
    this.children.forEach(child => {
      size += child.getSelectableSize();
    });
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

  updateFromTokens(tokens: Token[]) {
    // Break up tokens into children
    const tokenChildren = splitTokens(tokens);

    // Compare token children with current children and add/update/delete
    // children as needed
    const config = this.taleWeaver.getConfig();
    const children = this.children.slice();
    const invertedTokenChildren: {
      [key: string]: number;
    } = {};
    tokenChildren.forEach((tokenChild, offset) => {
      invertedTokenChildren[tokenChild.id] = offset;
    });
    const invertedChildren: {
      [key: string]: number;
    } = {};
    children.forEach((child, offset) => {
      invertedChildren[child.getID()] = offset;
    });
    const tokenChildrenSize = tokenChildren.length;
    const childrenSize = this.children.length;
    let tokenChildOffset = 0;
    let childOffset = 0;
    let operationOffset = 0;
    while (tokenChildOffset < tokenChildrenSize || childOffset < childrenSize) {
      if (!(tokenChildren[tokenChildOffset].id in invertedChildren) || childOffset === childrenSize) {
        // Insert child
        const tokenChild = tokenChildren[tokenChildOffset];
        const ChildClass = config.getInlineClass(tokenChild.type);
        const child = new ChildClass(this.taleWeaver, this, tokenChild.tokens);
        this.children.splice(operationOffset, 0, child);
        operationOffset++;
        tokenChildOffset++;
      } else if (!(children[childOffset].getID() in invertedTokenChildren) || tokenChildOffset === tokenChildrenSize) {
        // Delete child
        this.children.splice(operationOffset, 1);
        childOffset++;
      } else {
        // Update child
        const tokenChild = tokenChildren[tokenChildOffset];
        const child = children[childOffset];
        child.updateFromTokens(tokenChild.tokens);
        operationOffset++;
        tokenChildOffset++;
        childOffset++;
      }
    }
  }

  protected validateTokens(tokens: Token[]) {
    const startToken = tokens[0];
    if (!(startToken instanceof BlockStartToken)) {
      throw new Error('Invalid block tokens, first token is not a BlockStartToken.');
    }
    const endToken = tokens[tokens.length - 1];
    if (!(endToken instanceof BlockEndToken)) {
      throw new Error('Invalid block tokens, last token is not a BlockEndToken.');
    }
  }
}
