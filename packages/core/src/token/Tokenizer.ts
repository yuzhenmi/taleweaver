import Token from './Token';
import OpenTagToken from './OpenTagToken';
import CloseTagToken from './CloseTagToken';

enum TokenizerState {
  NewToken,
  NewTag,
  Tag,
  TagAttributes,
  TagAttributesString,
  TagAttributesStringEscape,
  CloseTag,
}

class Tokenizer {
  protected markup: string;
  protected tokenizerState: TokenizerState;
  protected tokens: Token[];
  protected tagBuffer: string;
  protected attributesBuffer: string;
  protected ran: boolean;

  constructor(markup: string) {
    this.markup = markup;
    this.tokenizerState = TokenizerState.NewToken;
    this.tokens = [];
    this.tagBuffer = '';
    this.attributesBuffer = '';
    this.ran = false;
  }

  getTokens() {
    this.tokenize();
    return this.tokens;
  }

  protected tokenize() {
    const markup = this.markup;
    let char: string;
    for (let n = 0, nn = markup.length; n < nn; n++) {
      char = markup[n];
      switch (this.tokenizerState) {
        case TokenizerState.NewToken:
          if (/</.test(char)) {
            this.newTag(char);
            break;
          }
          this.appendChar(char);
          break;
        case TokenizerState.NewTag:
          if (/A-Z/.test(char)) {
            this.appendCharToTag(char);
            break;
          }
          if (/\//.test(char)) {
            this.closeTag(char);
            break;
          }
        case TokenizerState.Tag:
          if (/[A-Za-z]/.test(char)) {
            this.appendCharToTag(char);
            break;
          }
          if (/{/.test(char)) {
            this.newAttributes(char);
            break;
          }
        case TokenizerState.TagAttributes:
          if (/"/.test(char)) {
            this.newAttributesString(char);
            break;
          }
          if (/>/.test(char)) {
            this.endTag(char);
            break;
          }
          this.appendCharToAttributes(char);
          break;
        case TokenizerState.TagAttributesString:
          if (/"/.test(char)) {
            this.endAttributesString(char);
            break;
          }
          if (/\\/.test(char)) {
            this.escapeNextAttributesStringChar(char);
            break;
          }
          this.appendCharToAttributes(char);
          break;
        case TokenizerState.TagAttributesStringEscape:
          this.appendCharToAttributes(char);
          break;
        case TokenizerState.CloseTag:
          if (/>/.test(char)) {
            this.endCloseTag(char);
            break;
          }
        default:
          throw new Error(`Unexpected character ${char} at offset ${n}.`);
      }
    }
    this.ran = true;
  }

  protected newTag(char: string) {
    this.tokenizerState = TokenizerState.NewTag;
  }

  protected appendChar(char: string) {
    this.tokens.push(char);
  }

  protected appendCharToTag(char: string) {
    this.tagBuffer += char;
    this.tokenizerState = TokenizerState.Tag;
  }

  protected newAttributes(char: string) {
    this.attributesBuffer += char;
    this.tokenizerState = TokenizerState.TagAttributes;
  }

  protected appendCharToAttributes(char: string) {
    this.attributesBuffer += char;
    if (this.tokenizerState === TokenizerState.TagAttributesStringEscape) {
      this.tokenizerState = TokenizerState.TagAttributesString;
    }
  }

  protected newAttributesString(char: string){
    this.attributesBuffer += char;
    this.tokenizerState = TokenizerState.TagAttributesString;
  }

  protected endTag(char: string) {
    let id: string;
    let attributes: {};
    try {
      ({ id, attributes } = JSON.parse(this.attributesBuffer));
    } catch (error) {
      throw new Error(`Invalid attributes JSON: ${this.attributesBuffer}.`);
    }
    if (!id) {
      throw new Error(`Missing id in attributes JSON: ${this.attributesBuffer}.`);
    }
    if (!this.tagBuffer) {
      throw new Error('Open tag type cannot be empty.');
    }
    const openTagToken = new OpenTagToken(this.tagBuffer, id, attributes);
    this.tokens.push(openTagToken);
    this.attributesBuffer = '';
    this.tagBuffer = '';
    this.tokenizerState = TokenizerState.NewToken;
  }

  protected endAttributesString(char: string) {
    this.attributesBuffer += char;
    this.tokenizerState = TokenizerState.TagAttributes;
  }

  protected escapeNextAttributesStringChar(char: string){
    this.tokenizerState = TokenizerState.TagAttributesStringEscape;
  }

  protected closeTag(char: string) {
    this.tokenizerState = TokenizerState.CloseTag;
  }

  protected endCloseTag(char: string) {
    const closeTagToken = new CloseTagToken();
    this.tokens.push(closeTagToken);
    this.tokenizerState = TokenizerState.NewToken;
  }
}

export default Tokenizer;
