import Config from '../Config';
import State from './State';
import Token from './Token';
import OpenTagToken from './OpenTagToken';
import CloseTagToken from './CloseTagToken';

enum TokenizerState {
  ReadyForToken,
  ReadingTag,
  ReadingTagType,
  ReadyForAttributes,
  ReadingAttributes,
  ReadyForTagEnd,
  Done,
}

const WHITESPACE_CHARS = [
  ' ',
  '\t',
  '\n',
];

function isWhitespace(char: string) {
  return WHITESPACE_CHARS.indexOf(char) >= 0;
}

function isAlphabet(char: string) {
  return (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z');
}

class Tokenizer {
  protected config: Config;
  protected state: State;
  protected tokens: Token[];
  protected tokenizerState: TokenizerState;
  protected nodeDepth: number;
  protected tagTypeBuffer: string[];
  protected tagAttributesBuffer: string[];
  protected attributesDepth: number;
  protected escapeNextChar: boolean;

  constructor(config: Config, markup: string) {
    this.config = config;
    this.state = new State();
    this.tokens = [];
    this.tokenizerState = TokenizerState.ReadyForToken;
    this.nodeDepth = 0;
    this.tagTypeBuffer = [];
    this.tagAttributesBuffer = [];
    this.attributesDepth = 0;
    this.escapeNextChar = false;
    this.tokenize(markup);
  }

  getState(): State {
    return this.state;
  }

  protected tokenize(markup: string) {
    this.reset();
    let offset = 0;
    while (offset < markup.length) {
      this.step(markup[offset], offset);
      offset += 1;
    }
    this.state.setTokens(this.tokens);
  }

  protected reset() {
    this.tokens = [];
    this.tokenizerState = TokenizerState.ReadyForToken;
    this.nodeDepth = 0;
    this.tagTypeBuffer = [];
    this.tagAttributesBuffer = [];
    this.attributesDepth = 0;
  }

  protected step(char: string, offset: number) {
    switch (this.tokenizerState) {
      case TokenizerState.ReadyForToken:
        if (this.nodeDepth === 0) {
          if (char !== '<') {
            throw new Error(`Unexpected ${char} at ${offset}, expecting <.`);
          }
        }
        if (char === '<') {
          this.tokenizerState = TokenizerState.ReadingTag;
          this.nodeDepth += 1;
        } else {
          this.tokens.push(char);
        }
        break;
      case TokenizerState.ReadingTag:
        if (char === '>') {
          this.tokens.push(new CloseTagToken());
          this.nodeDepth -= 1;
          if (this.nodeDepth === 0) {
            this.tokenizerState = TokenizerState.Done;
          } else {
            this.tokenizerState = TokenizerState.ReadyForToken;
          }
        } else {
          this.tokenizerState = TokenizerState.ReadingTagType;
          this.tagTypeBuffer.push(char);
        }
        break;
      case TokenizerState.ReadingTagType:
        if (isWhitespace(char)) {
          if (this.tagTypeBuffer.length === 0) {
            throw new Error(`Unexpected ${char} at ${offset}, open tag type is empty.`);
          }
          this.tokenizerState = TokenizerState.ReadyForAttributes;
        } else {
          if (!isAlphabet(char)) {
            throw new Error(`Unexpected ${char} at ${offset}, expecting tag type.`);
          }
          this.tagTypeBuffer.push(char);
        }
        break;
      case TokenizerState.ReadyForAttributes:
        if (isWhitespace(char)) {
          break;
        }
        if (char !== '{') {
          throw new Error(`Unexpected ${char} at ${offset}, expecting {.`);
        }
        this.tagAttributesBuffer.push(char);
        this.tokenizerState = TokenizerState.ReadingAttributes;
        this.attributesDepth += 1;
        break;
      case TokenizerState.ReadingAttributes:
        this.tagAttributesBuffer.push(char);
        if (char === '{') {
          this.attributesDepth += 1;
        } else if (char === '}') {
          this.attributesDepth -= 1;
          if (this.attributesDepth === 0) {
            this.tokenizerState = TokenizerState.ReadyForTagEnd;
          }
        }
        break;
      case TokenizerState.ReadyForTagEnd:
        if (isWhitespace(char)) {
          break;
        }
        if (char !== '>') {
          throw new Error(`Unexpected ${char} at ${offset}, expecting >.`);
        }
        const attributesJSON = this.tagAttributesBuffer.join('');
        let attributes: {};
        try {
          attributes = JSON.parse(attributesJSON);
        } catch (err) {
          throw new Error(`Invalid attributes at ${offset - 1}, cannot parse JSON ${attributesJSON}.`);
        }
        if (!('id' in attributes)) {
          throw new Error(`Invalid attributes at ${offset - 1}, missing id.`);
        }
        this.tokens.push(new OpenTagToken(this.tagTypeBuffer.join(''), attributes));
        this.tagAttributesBuffer = [];
        this.tagTypeBuffer = [];
        this.tokenizerState = TokenizerState.ReadyForToken;
        break;
      case TokenizerState.Done:
        if (isWhitespace(char)) {
          break;
        }
        throw new Error(`Unexpected ${char} at ${offset}, tokenization is done already.`);
      default:
        throw new Error('Tokenizer tokenizerState is corrupted.');
    }
  }
}

export default Tokenizer;
