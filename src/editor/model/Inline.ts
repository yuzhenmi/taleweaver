import TaleWeaver from '../TaleWeaver';
import Node from '../tree/Node';
import LeafNode from '../tree/LeafNode';
import TreePosition from '../tree/TreePosition';
import Token from '../state/Token';
import InlineStartToken from '../state/InlineStartToken';
import InlineEndToken from '../state/InlineEndToken';
import Block from './Block';

type Parent = Block;

interface Attributes {
  [key: string]: any;
}

export default abstract class Inline extends LeafNode {
  static fromTokens(taleWeaver: TaleWeaver, block: Block, tokens: Token[]): Inline {
    if (!(tokens[0] instanceof InlineStartToken)) {
      throw new Error(`Error building block from tokens, expecting first token to be InlineStartToken.`);
    }
    if (!(tokens[tokens.length - 1] instanceof InlineEndToken)) {
      throw new Error(`Error building block from tokens, expecting last token to be InlineEndToken.`);
    }
    const startToken = tokens[0] as InlineStartToken;
    const InlineClass = taleWeaver.getConfig().getInlineClass(startToken.getType());
    const inline = new InlineClass(block, tokens.slice(1, tokens.length - 1).join(''), startToken.getAttributes());
    return inline;
  }

  protected taleWeaver: TaleWeaver;
  protected parent: Parent;
  protected attributes: Attributes;
  protected content: string;

  constructor(taleWeaver: TaleWeaver, parent: Parent, tokens: Token[]) {
    super();
    this.taleWeaver = taleWeaver;
    this.parent = parent;
    if (!(tokens[0] instanceof InlineStartToken)) {
      throw new Error(`Error building inline from tokens, expecting first token to be InlineStartToken.`);
    }
    if (!(tokens[tokens.length - 1] instanceof InlineEndToken)) {
      throw new Error(`Error building inline from tokens, expecting last token to be InlineEndToken.`);
    }
    const startToken = tokens[0] as InlineStartToken;
    this.attributes = startToken.getAttributes();
    this.content = tokens.slice(1, tokens.length - 1).join('');
  }

  getSize(): number {
    return this.content.length;
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

  parentAt(offset: number): TreePosition {
    if (offset < 0) {
      throw new Error(`Inline offset out of range: ${offset}.`);
    }
    if (offset > this.getSize() - 1) {
      throw new Error(`Inline offset out of range: ${offset}.`);
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
    throw new Error(`Model is corrupted, inline not found in parent.`);
  }

  setContent(content: string) {
    this.content = content;
  }

  getContent(): string {
    return this.content;
  }
}
