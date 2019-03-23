import Config from '../Config';
import Token from './Token';
import OpenTagToken from './OpenTagToken';
import CloseTagToken from './CloseTagToken';
import State from './State';

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
  protected config: Config;
  protected markup: string;
  protected state: TokenizerState;
  protected tokens: Token[];
  protected tagBuffer: string;
  protected attributesBuffer: string;

  constructor(config: Config, markup: string) {
    this.config = config;
    this.markup = markup;
    this.state = TokenizerState.NewToken;
    this.tokens = [];
    this.tagBuffer = '';
    this.attributesBuffer = '';
  }

  run() {
    this.tokens = [];
    for (let n = 0, nn = this.markup.length; n < nn; n++) {
      const char = this.markup[n];
      switch (this.state) {
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
    const state = new State();
    state.setTokens(this.tokens);
    return state;
  }

  protected newTag(char: string) {
    this.state = TokenizerState.NewTag;
  }

  protected appendChar(char: string) {
    this.tokens.push(char);
  }

  protected appendCharToTag(char: string) {
    this.tagBuffer += char;
    this.state = TokenizerState.Tag;
  }

  protected newAttributes(char: string) {
    this.attributesBuffer += char;
    this.state = TokenizerState.TagAttributes;
  }

  protected appendCharToAttributes(char: string) {
    this.attributesBuffer += char;
    if (this.state === TokenizerState.TagAttributesStringEscape) {
      this.state = TokenizerState.TagAttributesString;
    }
  }

  protected newAttributesString(char: string){
    this.attributesBuffer += char;
    this.state = TokenizerState.TagAttributesString;
  }

  protected endTag(char: string) {
    let attributes: {};
    try {
      attributes = JSON.parse(this.attributesBuffer);
    } catch (error) {
      throw new Error(`Invalid attributes JSON: ${this.attributesBuffer}.`);
    }
    if (!('id' in attributes)) {
      throw new Error(`Missing id in attributes JSON: ${this.attributesBuffer}.`);
    }
    const openTagToken = new OpenTagToken(this.tagBuffer, attributes);
    this.tokens.push(openTagToken);
    this.attributesBuffer = '';
    this.tagBuffer = '';
    this.state = TokenizerState.NewToken;
  }

  protected endAttributesString(char: string) {
    this.attributesBuffer += char;
    this.state = TokenizerState.TagAttributes;
  }

  protected escapeNextAttributesStringChar(char: string){
    this.state = TokenizerState.TagAttributesStringEscape;
  }

  protected closeTag(char: string) {
    this.state = TokenizerState.CloseTag;
  }

  protected endCloseTag(char: string) {
    const closeTagToken = new CloseTagToken();
    this.tokens.push(closeTagToken);
    this.state = TokenizerState.NewToken;
  }
}

export default Tokenizer;
