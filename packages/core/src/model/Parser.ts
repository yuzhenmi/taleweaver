import Editor from '../Editor';
import TreeSyncer from '../utils/TreeSyncer';
import { TokenStateUpdatedEvent, ModelStateUpdatedEvent } from '../dispatch/events';
import Token from '../token/Token';
import OpenTagToken from '../token/OpenTagToken';
import CloseTagToken from '../token/CloseTagToken';
import Element from './Element';
import Doc from './Doc';
import BlockElement from './BlockElement';
import InlineElement from './InlineElement';

class ModelTreeSyncer extends TreeSyncer<Element, Element> {
  protected editor: Editor;

  constructor(editor: Editor) {
    super();
    this.editor = editor;
  }

  getSrcNodeChildren(node: Element) {
    if (node instanceof Doc) {
      return node.getChildren();
    }
    if (node instanceof BlockElement) {
      return node.getChildren();
    }
    return [];
  }

  getDstNodeChildren(node: Element) {
    if (node instanceof Doc) {
      return [...node.getChildren()];
    }
    if (node instanceof BlockElement) {
      return [...node.getChildren()];
    }
    return [];
  }

  findSrcNodeInDstNodes(srcNode: Element, dstNodes: Element[]) {
    const id = srcNode.getID();
    const offset = dstNodes.findIndex(n => n.getID() === id);
    return offset;
  }

  insertNode(parent: Element, srcNode: Element, offset: number) {
    const elementConfig = this.editor.getConfig().getElementConfig();
    if (parent instanceof Doc && srcNode instanceof BlockElement) {
      const ElementClass = elementConfig.getBlockElementClass(srcNode.getType());
      const element = new ElementClass(this.editor);
      if (!(element instanceof BlockElement)) {
        throw new Error('Error inserting element, expecting block element.');
      }
      element.setID(srcNode.getID());
      parent.insertChild(element, offset);
      return element;
    }
    if (parent instanceof BlockElement && srcNode instanceof InlineElement) {
      const ElementClass = elementConfig.getInlineElementClass(srcNode.getType());
      const element = new ElementClass(this.editor);
      if (!(element instanceof InlineElement)) {
        throw new Error('Error inserting element, expecting inline element.');
      }
      element.setID(srcNode.getID());
      parent.insertChild(element, offset);
      return element;
    }
    throw new Error('Error inserting element, type mismatch.');
  }

  deleteNode(parent: Element, node: Element) {
    if (parent instanceof Doc && node instanceof BlockElement) {
      parent.deleteChild(node);
      return;
    }
    if (parent instanceof BlockElement && node instanceof InlineElement) {
      parent.deleteChild(node);
      return;
    }
    throw new Error('Error deleting element, type mismatch.');
  }

  updateNode(node: Element, srcNode: Element) {
    if (node instanceof Doc && srcNode instanceof Doc) {
      const attributes = srcNode.getAttributes();
      node.onStateUpdated(attributes);
      return true;
    }
    if (node instanceof BlockElement && srcNode instanceof BlockElement) {
      const attributes = srcNode.getAttributes();
      node.onStateUpdated(attributes);
      return true;
    }
    if (node instanceof InlineElement && srcNode instanceof InlineElement) {
      const attributes = srcNode.getAttributes();
      node.onStateUpdated(attributes);
      const content = srcNode.getContent();
      if (node.getContent() !== content) {
        node.setContent(content);
      }
      return true;
    }
    throw new Error('Error updating render node, type mismatch.');
  }
}

enum ParserState {
  NewDoc,
  NewElement,
  InlineElement,
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

class Parser {
  protected editor: Editor;
  protected doc: Doc;
  protected parserState: ParserState;
  protected stack: Stack;
  protected contentBuffer: string;

  constructor(editor: Editor, doc: Doc) {
    this.editor = editor;
    this.doc = doc;
    this.parserState = ParserState.NewDoc;
    this.stack = new Stack();
    this.contentBuffer = '';
    editor.getDispatcher().on(TokenStateUpdatedEvent, event => this.sync());
    this.sync();
  }

  protected sync() {
    this.parserState = ParserState.NewDoc;
    const newDoc = this.parse();
    const treeSyncer = new ModelTreeSyncer(this.editor);
    this.doc.setID(newDoc.getID());
    treeSyncer.syncNodes(newDoc, this.doc);
    const updatedElements = treeSyncer.getUpdatedNodes();
    updatedElements.forEach(element => {
      element.bumpVersion();
      if (element instanceof BlockElement || element instanceof InlineElement) {
        updatedElements.add(element.getParent());
      }
    });
    this.editor.getDispatcher().dispatch(new ModelStateUpdatedEvent());
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

export default Parser;
