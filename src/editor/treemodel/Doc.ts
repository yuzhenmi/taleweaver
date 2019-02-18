import TaleWeaver from '../TaleWeaver';
import Token from '../flatmodel/Token';
import DocStartToken from '../flatmodel/DocStartToken';
import DocEndToken from '../flatmodel/DocEndToken';
import BlockStartToken from '../flatmodel/BlockStartToken';
import BlockEndToken from '../flatmodel/BlockEndToken';
import Block from './Block';

type Child = Block;

interface Attributes {
  [key: string]: any;
}

export default class Doc {
  protected taleWeaver: TaleWeaver;
  protected children: Child[];
  protected attributes: Attributes;

  constructor(taleWeaver: TaleWeaver, tokens: Token[]) {
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

  getSize(): number {
    let size = 2;
    this.children.forEach(child => {
      size += child.getSize();
    });
    return size;
  }
}
