import TaleWeaver from '../TaleWeaver';
import Token from '../flatmodel/Token';
import InlineStartToken from '../flatmodel/InlineStartToken';
import InlineEndToken from '../flatmodel/InlineEndToken';
import Block from './Block';

type Parent = Block;

interface Attributes {
  [key: string]: any;
}

export default abstract class Inline {
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
    this.taleWeaver = taleWeaver;
    this.parent = parent;
    if (!(tokens[0] instanceof InlineStartToken)) {
      throw new Error(`Error building block from tokens, expecting first token to be InlineStartToken.`);
    }
    if (!(tokens[tokens.length - 1] instanceof InlineEndToken)) {
      throw new Error(`Error building block from tokens, expecting last token to be InlineEndToken.`);
    }
    const startToken = tokens[0] as InlineStartToken;
    this.attributes = startToken.getAttributes();
    this.content = tokens.slice(1, tokens.length - 1).join('');
  }

  setContent(content: string) {
    this.content = content;
  }

  getContent(): string {
    return this.content;
  }

  abstract getType(): string;

  abstract getSize(): number;
}
