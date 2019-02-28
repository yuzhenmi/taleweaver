import TaleWeaver from '../TaleWeaver';
import Token from '../state/Token';
import InlineStartToken from '../state/InlineStartToken';
import InlineEndToken from '../state/InlineEndToken';
import LeafNode from './LeafNode';
import Block from './Block';

type Parent = Block;

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
  protected id: string;
  protected content: string;

  constructor(taleWeaver: TaleWeaver, parent: Parent, tokens: Token[]) {
    super();
    this.taleWeaver = taleWeaver;
    this.parent = parent;
    this.validateTokens(tokens);
    const startToken = tokens[0] as InlineStartToken;
    const { id } = startToken.getAttributes();
    this.id = id;
    this.content = '';
    this.updateFromTokens(tokens);
  }

  getID(): string {
    return this.id;
  }

  getSize(): number {
    return this.content.length + 2;
  }

  getSelectableSize(): number {
    return Math.max(this.content.length, 1);
  }

  getParent(): Parent {
    return this.parent;
  }

  setContent(content: string) {
    this.content = content;
  }

  getContent(): string {
    return this.content;
  }

  updateFromTokens(tokens: Token[]) {
    this.content = tokens.slice(1, tokens.length - 1).join('');
  }

  protected validateTokens(tokens: Token[]) {
    const startToken = tokens[0];
    if (!(startToken instanceof InlineStartToken)) {
      throw new Error('Invalid inline tokens, first token is not a InlineStartToken.');
    }
    const endToken = tokens[tokens.length - 1];
    if (!(endToken instanceof InlineEndToken)) {
      throw new Error('Invalid inline tokens, last token is not a InlineEndToken.');
    }
  }
}
