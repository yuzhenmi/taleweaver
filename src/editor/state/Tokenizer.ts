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
  private markup: string;
  private tokens: Token[];
  private offset: number;
  private state: State;
  private nodeDepth: number;
  private tagTypeBuffer: string[];
  private tagAttributesBuffer: string[];
  private attributesDepth: number;
  private escapeNextChar: boolean;
  private ran: boolean;

  constructor(markup: string) {
    this.markup = markup;
    this.tokens = [];
    this.offset = 0;
    this.state = State.ReadyForToken;
    this.nodeDepth = 0;
    this.tagTypeBuffer = [];
    this.tagAttributesBuffer = [];
    this.attributesDepth = 0;
    this.escapeNextChar = false;
    this.ran = false;
  }

  tokenize(): Token[] {
    if (this.ran) {
      return this.tokens;
    }
    while (this.offset < this.markup.length) {
      this.step();
    }
    this.ran = true;
    return this.tokens;
  }

  private step() {
    const char = this.markup[this.offset];
    if (char === '\\') {
      this.escapeNextChar = true;
      this.offset += 1;
      return;
    }
    switch (this.state) {
      case State.ReadyForToken:
        if (this.nodeDepth === 0) {
          if (char !== '<') {
            throw new Error(`Unexpected ${char} at ${this.offset}, expecting <.`);
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
            throw new Error(`Unexpected ${char} at ${this.offset}, open tag type is empty.`);
          }
          this.state = State.ReadyForAttributes;
        } else {
          if (!isAlphabet(char)) {
            throw new Error(`Unexpected ${char} at ${this.offset}, expecting tag type.`);
          }
          this.tagTypeBuffer.push(char);
        }
        break;
      case State.ReadyForAttributes:
        if (isWhitespace(char)) {
          break;
        }
        if (char !== '{') {
          throw new Error(`Unexpected ${char} at ${this.offset}, expecting {.`);
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
          throw new Error(`Unexpected ${char} at ${this.offset}, expecting >.`);
        }
        const attributesJSON = this.tagAttributesBuffer.join('');
        let attributes: {};
        try {
          attributes = JSON.parse(attributesJSON);
        } catch (err) {
          throw new Error(`Invalid attributes at ${this.offset - 1}, cannot parse JSON ${attributesJSON}.`);
        }
        if (!('id' in attributes)) {
          throw new Error(`Invalid attributes at ${this.offset - 1}, missing id.`);
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
        throw new Error(`Unexpected ${char} at ${this.offset}, tokenization is done already.`);
      default:
        throw new Error('Tokenizer state is corrupted.');
    }
    this.escapeNextChar = false;
    this.offset += 1;
  }
}

export default Tokenizer;
