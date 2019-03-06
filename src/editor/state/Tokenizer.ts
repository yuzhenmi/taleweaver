import Config from '../Config';
import Token from './Token';
import OpenTagToken from './OpenTagToken';
import CloseTagToken from './CloseTagToken';

enum State {
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
  protected tokens: Token[];
  protected state: State;
  protected nodeDepth: number;
  protected tagTypeBuffer: string[];
  protected tagAttributesBuffer: string[];
  protected attributesDepth: number;
  protected escapeNextChar: boolean;

  constructor(config: Config) {
    this.config = config;
    this.tokens = [];
    this.state = State.ReadyForToken;
    this.nodeDepth = 0;
    this.tagTypeBuffer = [];
    this.tagAttributesBuffer = [];
    this.attributesDepth = 0;
    this.escapeNextChar = false;
  }

  tokenize(markup: string): Token[] {
    this.reset();
    let offset = 0;
    while (offset < markup.length) {
      this.step(markup[offset], offset);
      offset += 1;
    }
    return this.tokens;
  }

  private reset() {
    this.tokens = [];
    this.state = State.ReadyForToken;
    this.nodeDepth = 0;
    this.tagTypeBuffer = [];
    this.tagAttributesBuffer = [];
    this.attributesDepth = 0;
  }

  private step(char: string, offset: number) {
    switch (this.state) {
      case State.ReadyForToken:
        if (this.nodeDepth === 0) {
          if (char !== '<') {
            throw new Error(`Unexpected ${char} at ${offset}, expecting <.`);
          }
        }
        if (char === '<') {
          this.state = State.ReadingTag;
          this.nodeDepth += 1;
        } else {
          this.tokens.push(char);
        }
        break;
      case State.ReadingTag:
        if (char === '>') {
          this.tokens.push(new CloseTagToken());
          this.nodeDepth -= 1;
          if (this.nodeDepth === 0) {
            this.state = State.Done;
          } else {
            this.state = State.ReadyForToken;
          }
        } else {
          this.state = State.ReadingTagType;
          this.tagTypeBuffer.push(char);
        }
        break;
      case State.ReadingTagType:
        if (isWhitespace(char)) {
          if (this.tagTypeBuffer.length === 0) {
            throw new Error(`Unexpected ${char} at ${offset}, open tag type is empty.`);
          }
          this.state = State.ReadyForAttributes;
        } else {
          if (!isAlphabet(char)) {
            throw new Error(`Unexpected ${char} at ${offset}, expecting tag type.`);
          }
          this.tagTypeBuffer.push(char);
        }
        break;
      case State.ReadyForAttributes:
        if (isWhitespace(char)) {
          break;
        }
        if (char !== '{') {
          throw new Error(`Unexpected ${char} at ${offset}, expecting {.`);
        }
        this.tagAttributesBuffer.push(char);
        this.state = State.ReadingAttributes;
        this.attributesDepth += 1;
        break;
      case State.ReadingAttributes:
        this.tagAttributesBuffer.push(char);
        if (char === '{') {
          this.attributesDepth += 1;
        } else if (char === '}') {
          this.attributesDepth -= 1;
          if (this.attributesDepth === 0) {
            this.state = State.ReadyForTagEnd;
          }
        }
        break;
      case State.ReadyForTagEnd:
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
        this.state = State.ReadyForToken;
        break;
      case State.Done:
        if (isWhitespace(char)) {
          break;
        }
        throw new Error(`Unexpected ${char} at ${offset}, tokenization is done already.`);
      default:
        throw new Error('Tokenizer state is corrupted.');
    }
  }
}

export default Tokenizer;
