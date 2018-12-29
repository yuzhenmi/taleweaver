import BlockElement from '../../model/BlockElement';
import InlineElement from '../../model/InlineElement';
import Document from '../../model/Document';
import Paragraph from '../../model/Paragraph';
import Text from '../../model/Text';

type BlockElementClass = new (...args: any[]) => BlockElement;
type InlineElementClass = new (...args: any[]) => InlineElement;
type InlineJSON = {
  type: string;
  content: string;
};
type BlockJSON = {
  type: string;
  children: InlineJSON[];
};
type DocumentJSON = {
  children: BlockJSON[];
};

export default class JSONParser {
  private registeredBlockElements: Map<string, BlockElementClass>;
  private registeredInlineElements: Map<string, InlineElementClass>;

  constructor() {
    this.registeredBlockElements = new Map<string, BlockElementClass>();
    this.registeredBlockElements.set('Paragraph', Paragraph);
    this.registeredInlineElements = new Map<string, InlineElementClass>();
    this.registeredInlineElements.set('Text', Text);
  }

  registerBlockElement(type: string, ElementClass: BlockElementClass) {
    this.registeredBlockElements.set(type, ElementClass);
  }

  getBlockElement(type: string): BlockElementClass {
    if (!this.registeredBlockElements.has(type)) {
      throw new Error(`Unregistered block element type: ${type}`);
    }
    return this.registeredBlockElements.get(type)!;
  }

  registerInlineElement(type: string, ElementClass: InlineElementClass) {
    this.registeredInlineElements.set(type, ElementClass);
  }

  getInlineElement(type: string): InlineElementClass {
    if (!this.registeredInlineElements.has(type)) {
      throw new Error(`Unregistered inline element type: ${type}`);
    }
    return this.registeredInlineElements.get(type)!;
  }

  parse(json: DocumentJSON): Document {
    const document = new Document();
    json.children.map(blockJSON => {
      const blockElementClass = this.getBlockElement(blockJSON.type);
      const blockElement = new blockElementClass(document);
      document.appendChild(blockElement);
      blockJSON.children.map(inlineJSON => {
        const inlineElementClass = this.getInlineElement(inlineJSON.type);
        const inlineElement = new inlineElementClass(blockElement, inlineJSON.content);
        blockElement.appendChild(inlineElement);
      });
    });
    return document;
  }
}
