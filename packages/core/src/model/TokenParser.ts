import Editor from '../Editor';
import ModelNode from './ModelNode';

enum ParserState {
  NewRootNode,
  NewNode,
  Content,
}

class Stack {
  protected elements: Element[];

  constructor() {
    this.elements = [];
  }

  push(element: Element) {
    this.elements.push(element);
  }

  pop(): Element | undefined {
    return this.elements.pop();
  }

  peek(): Element | undefined {
    return this.elements[this.elements.length - 1];
  }
}

export default class Parser {
  protected editor: Editor;
  protected parserState: ParserState = ParserState.NewRootNode;
  protected rootNode?: ModelNode<any, any, any>;
  protected stack: Stack = new Stack();
  protected contentBuffer: string = '';
  protected ran: boolean = false;

  constructor(editor: Editor) {
    this.editor = editor;
  }

  getRootNode() {
    if (!this.ran) {
      this.parse();
    }
    return this.rootNode!;
  }

  protected parse() {
    const newDoc = new Doc(this.editor);
    this.stack = new Stack();
    this.stack.push(newDoc);
    const tokens = this.editor.getTokenManager().getTokenState().getTokens();
    let token: Token;
    for (let n = 0, nn = tokens.length; n < nn; n++) {
      token = tokens[n];
      switch (this.parserState) {
        case ParserState.NewDoc:
          if (token instanceof OpenTagToken && token.getType() === 'Doc') {
            this.newDoc(token);
            break;
          }
        case ParserState.NewElement:
          if (token instanceof OpenTagToken) {
            this.newElement(token);
            break;
          }
          if (typeof token === 'string') {
            this.appendToContent(token);
            break;
          }
          if (token instanceof CloseTagToken) {
            this.closeNode(token);
            break;
          }
          this.appendToContent(token);
          break;
        case ParserState.InlineElement:
          if (typeof token === 'string') {
            this.appendToContent(token);
            break;
          }
          if (token instanceof CloseTagToken) {
            this.closeNode(token);
            break;
          }
        default:
          throw new Error(`Unexpected token at offset ${n}.`);
      }
    }
    return newDoc;
  }

  protected newDoc(token: OpenTagToken) {
    const doc = this.stack.peek();
    if (!(doc instanceof Doc)) {
      throw new Error('Expected doc.');
    }
    const attributes = token.getAttributes();
    doc.setID(token.getID());
    doc.onStateUpdated(attributes);
    this.parserState = ParserState.NewElement;
  }

  protected newElement(token: OpenTagToken) {
    const elementConfig = this.editor.getConfig().getElementConfig();
    const parentElement = this.stack.peek();
    if (!parentElement) {
      throw new Error('Unexpected end of doc encountered.');
    }
    const ElementClass = elementConfig.getElementClass(token.getType());
    const element = new ElementClass(this.editor);
    const attributes = token.getAttributes();
    element.setID(token.getID());
    element.onStateUpdated(attributes);
    if (parentElement instanceof Doc) {
      if (!(element instanceof BlockElement)) {
        throw new Error('Unexpected child element for doc.');
      }
      parentElement.insertChild(element);
    } else if (parentElement instanceof BlockElement) {
      if (!(element instanceof InlineElement)) {
        throw new Error('Unexpected child element for block element.');
      }
      parentElement.insertChild(element);
    }
    this.stack.push(element);
  }

  protected appendToContent(token: string) {
    this.contentBuffer += token;
    this.parserState = ParserState.InlineElement;
  }

  protected closeNode(token: CloseTagToken) {
    const element = this.stack.pop();
    if (element === undefined) {
      throw new Error('Unexpected end of doc encountered.');
    }
    if (element instanceof InlineElement) {
      element.setContent(this.contentBuffer);
    }
    this.contentBuffer = '';
    this.parserState = ParserState.NewElement;
  }
}
