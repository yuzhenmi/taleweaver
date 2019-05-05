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
  protected lastVersion: number;

  constructor(editor: Editor, lastVersion: number) {
    super();
    this.editor = editor;
    this.lastVersion = lastVersion;
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
    if (parent instanceof Doc && srcNode instanceof BlockElement) {
      const ElementClass = this.editor.getConfig().getElementClass(srcNode.getType());
      const element = new ElementClass();
      if (!(element instanceof BlockElement)) {
        throw new Error('Error inserting element, expecting block element.');
      }
      element.setID(srcNode.getID());
      parent.insertChild(element, offset);
      this.updateElementVersion(element);
      return element;
    }
    if (parent instanceof BlockElement && srcNode instanceof InlineElement) {
      const ElementClass = this.editor.getConfig().getElementClass(srcNode.getType());
      const element = new ElementClass();
      if (!(element instanceof InlineElement)) {
        throw new Error('Error inserting element, expecting inline element.');
      }
      element.setID(srcNode.getID());
      parent.insertChild(element, offset);
      this.updateElementVersion(element);
      return element;
    }
    throw new Error('Error inserting element, type mismatch.');
  }

  deleteNode(parent: Element, node: Element) {
    if (parent instanceof Doc && node instanceof BlockElement) {
      parent.deleteChild(node);
      this.updateElementVersion(parent);
      return;
    }
    if (parent instanceof BlockElement && node instanceof InlineElement) {
      parent.deleteChild(node);
      this.updateElementVersion(parent);
      return;
    }
    throw new Error('Error deleting element, type mismatch.');
  }

  updateNode(node: Element, srcNode: Element) {
    if (node instanceof Doc && srcNode instanceof Doc) {
      const attributes = srcNode.getAttributes();
      if (node.onStateUpdated(attributes)) {
        this.updateElementVersion(node);
      }
      return true;
    }
    if (node instanceof BlockElement && srcNode instanceof BlockElement) {
      const attributes = srcNode.getAttributes();
      if (node.onStateUpdated(attributes)) {
        this.updateElementVersion(node);
      }
      return true;
    }
    if (node instanceof InlineElement && srcNode instanceof InlineElement) {
      const attributes = srcNode.getAttributes();
      let isUpdated = false;
      if (node.onStateUpdated(attributes)) {
        isUpdated = true;
      }
      const content = srcNode.getContent();
      if (node.getContent() !== content) {
        node.setContent(content);
        isUpdated = true;
      }
      if (isUpdated) {
        this.updateElementVersion(node);
      }
      return true;
    }
    throw new Error('Error updating render node, type mismatch.');
  }

  protected updateElementVersion(element: Element) {
    element.setVersion(this.lastVersion + 1);
    if (element instanceof InlineElement) {
      this.updateElementVersion(element.getParent());
    } else if (element instanceof BlockElement) {
      this.updateElementVersion(element.getParent());
    }
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
  protected version: number;

  constructor(editor: Editor, doc: Doc) {
    this.editor = editor;
    this.doc = doc;
    this.parserState = ParserState.NewDoc;
    this.stack = new Stack();
    this.contentBuffer = '';
    this.version = 0;
    editor.getDispatcher().on(TokenStateUpdatedEvent, event => this.sync());
    this.sync();
  }

  protected sync() {
    this.parserState = ParserState.NewDoc;
    const newDoc = this.parse();
    const treeSyncer = new ModelTreeSyncer(this.editor, this.version);
    this.doc.setID(newDoc.getID());
    treeSyncer.syncNodes(newDoc, this.doc);
    this.version = this.doc.getVersion();
    this.editor.getDispatcher().dispatch(new ModelStateUpdatedEvent());
  }

  protected parse() {
    const newDoc = new Doc();
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
    const parentElement = this.stack.peek();
    if (!parentElement) {
      throw new Error('Unexpected end of doc encountered.');
    }
    const ElementClass = this.editor.getConfig().getElementClass(token.getType());
    const element = new ElementClass();
    const attributes = token.getAttributes();
    element.setID(token.getID());
    element.onStateUpdated(attributes);
    if (parentElement instanceof Doc) {
      if (!(element instanceof BlockElement)) {
        throw new Error('Unexpected child element for doc.');
      }
      parentElement.insertChild(element)
    } else if (parentElement instanceof BlockElement) {
      if (!(element instanceof InlineElement)) {
        throw new Error('Unexpected child element for block element.');
      }
      parentElement.insertChild(element)
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
