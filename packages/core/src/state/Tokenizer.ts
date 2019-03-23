import Config from '../Config';
import Token from './Token';
import OpenTagToken from './OpenTagToken';
import CloseTagToken from './CloseTagToken';
import State from './State';

class TokenizerState {
  protected label: string;

  constructor(label: string) {
    this.label = label;
  }

  getLabel(): string {
    return this.label;
  }
}

const S_NEW_TOKEN = new TokenizerState('new token');
const S_NEW_TAG = new TokenizerState('new tag');
const S_TAG = new TokenizerState('tag');
const S_TAG_ATTRIBUTES = new TokenizerState('tag attributes');
const S_TAG_ATTRIBUTES_STRING = new TokenizerState('tag attributes string');
const S_TAG_ATTRIBUTES_STRING_ESCAPE = new TokenizerState('tag attributes string escape');
const S_CLOSE_TAG = new TokenizerState('close tag');

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
    this.state = S_NEW_TOKEN;
    this.tokens = [];
    this.tagBuffer = '';
    this.attributesBuffer = '';
  }

  run() {
    this.tokens = [];
    for (let n = 0, nn = this.markup.length; n < nn; n++) {
      const char = this.markup[n];
      switch (this.state) {
        case S_NEW_TOKEN:
          if (/</.test(char)) {
            this.newTag(char);
            break;
          }
          this.appendChar(char);
          break;
        case S_NEW_TAG:
          if (/A-Z/.test(char)) {
            this.appendCharToTag(char);
            break;
          }
          if (/\//.test(char)) {
            this.closeTag(char);
            break;
          }
        case S_TAG:
          if (/[A-Za-z]/.test(char)) {
            this.appendCharToTag(char);
            break;
          }
          if (/{/.test(char)) {
            this.newAttributes(char);
            break;
          }
        case S_TAG_ATTRIBUTES:
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
        case S_TAG_ATTRIBUTES_STRING:
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
        case S_TAG_ATTRIBUTES_STRING_ESCAPE:
          this.appendCharToAttributes(char);
          break;
        case S_CLOSE_TAG:
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
    this.state = S_NEW_TAG;
  }

  protected appendChar(char: string) {
    this.tokens.push(char);
  }

  protected appendCharToTag(char: string) {
    this.tagBuffer += char;
    this.state = S_TAG;
  }

  protected newAttributes(char: string) {
    this.attributesBuffer += char;
    this.state = S_TAG_ATTRIBUTES;
  }

  protected appendCharToAttributes(char: string) {
    this.attributesBuffer += char;
    if (this.state === S_TAG_ATTRIBUTES_STRING_ESCAPE) {
      this.state = S_TAG_ATTRIBUTES_STRING;
    }
  }

  protected newAttributesString(char: string){
    this.attributesBuffer += char;
    this.state = S_TAG_ATTRIBUTES_STRING;
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
    this.state = S_NEW_TOKEN;
  }

  protected endAttributesString(char: string) {
    this.attributesBuffer += char;
    this.state = S_TAG_ATTRIBUTES;
  }

  protected escapeNextAttributesStringChar(char: string){
    this.state = S_TAG_ATTRIBUTES_STRING_ESCAPE;
  }

  protected closeTag(char: string) {
    this.state = S_CLOSE_TAG;
  }

  protected endCloseTag(char: string) {
    const closeTagToken = new CloseTagToken();
    this.tokens.push(closeTagToken);
    this.state = S_NEW_TOKEN;
  }
}

export default Tokenizer;
