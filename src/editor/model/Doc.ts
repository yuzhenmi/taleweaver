import TaleWeaver from '../TaleWeaver';
import Token from '../state/Token';
import DocStartToken from '../state/DocStartToken';
import DocEndToken from '../state/DocEndToken';
import BlockStartToken from '../state/BlockStartToken';
import BlockEndToken from '../state/BlockEndToken';
import RootNode from './RootNode';
import Block from './Block';
import ResolvedPosition from './ResolvedPosition';

type Child = Block;

interface Attributes {
  [key: string]: any;
}

export default class Doc extends RootNode {
  static getType(): string {
    return 'Doc';
  }

  protected taleWeaver: TaleWeaver;
  protected children: Child[];
  protected attributes: Attributes;

  constructor(taleWeaver: TaleWeaver, tokens: Token[]) {
    super();
    this.taleWeaver = taleWeaver;
    this.children = [];
    if (!(tokens[0] instanceof DocStartToken)) {
      throw new Error(`Error building doc from tokens, expecting first token to be DocStartToken.`);
    }
    if (!(tokens[tokens.length - 1] instanceof DocEndToken)) {
      throw new Error(`Error building doc from tokens, expecting last token to be DocEndToken.`);
    }
    const startToken = tokens[0] as DocStartToken;
    this.attributes = startToken.getAttributes();
    let childStartOffset = 1;
    let depth = 0;
    for (let n = 1, nn = tokens.length - 1; n < nn; n++) {
      const token = tokens[n];
      if (token instanceof BlockStartToken) {
        if (depth === 0) {
          childStartOffset = n;
        }
        depth += 1;
      } else if (token instanceof BlockEndToken) {
        depth -= 1;
      }
      if (depth === 0) {
        const childTokens = tokens.slice(childStartOffset, n + 1);
        const blockStartToken = tokens[childStartOffset] as BlockStartToken;
        const BlockClass = taleWeaver.getConfig().getBlockClass(blockStartToken.getType());
        const block = new BlockClass(taleWeaver, this, childTokens);
        this.appendChild(block);
      }
    }
  }

  getType(): string {
    return Doc.getType();
  }

  getSize(): number {
    let size = 1;
    this.children.forEach(child => {
      size += child.getSize();
    });
    size += 1;
    return size;
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

  childAt(offset: number): ResolvedPosition {
    if (offset < 0) {
      throw new Error(`Doc offset out of range: ${offset}`);
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
    throw new Error(`Doc offset out of range: ${offset}`);
  }
}
