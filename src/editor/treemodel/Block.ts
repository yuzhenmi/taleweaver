import TaleWeaver from '../TaleWeaver';
import Token from '../flatmodel/Token';
import BlockStartToken from '../flatmodel/BlockStartToken';
import BlockEndToken from '../flatmodel/BlockEndToken';
import InlineStartToken from '../flatmodel/InlineStartToken';
import InlineEndToken from '../flatmodel/InlineEndToken';
import Doc from './Doc';
import Inline from './Inline';

type Parent = Doc;
type Child = Inline;

interface Attributes {
  [key: string]: any;
}

export default abstract class Block {
  protected taleWeaver: TaleWeaver;
  protected parent: Parent;
  protected children: Child[];
  protected attributes: Attributes;

  constructor(taleWeaver: TaleWeaver, parent: Parent, tokens: Token[]) {
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

  abstract getType(): string;
  
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
