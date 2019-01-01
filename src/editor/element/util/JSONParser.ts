import { BlockClass } from '../block/Block';
import { InlineClass } from '../inline/Inline';
import Document from '../Document';
import Paragraph from '../block/Paragraph';
import Text from '../inline/Text';

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
  private registeredBlocks: Map<string, BlockClass>;
  private registeredInlines: Map<string, InlineClass>;

  constructor() {
    this.registeredBlocks = new Map<string, BlockClass>();
    this.registeredBlocks.set('Paragraph', Paragraph);
    this.registeredInlines = new Map<string, InlineClass>();
    this.registeredInlines.set('Text', Text);
  }

  registerBlock(type: string, ElementClass: BlockClass) {
    this.registeredBlocks.set(type, ElementClass);
  }

  getBlock(type: string): BlockClass {
    if (!this.registeredBlocks.has(type)) {
      throw new Error(`Unregistered block type: ${type}`);
    }
    return this.registeredBlocks.get(type)!;
  }

  registerInline(type: string, ElementClass: InlineClass) {
    this.registeredInlines.set(type, ElementClass);
  }

  getInline(type: string): InlineClass {
    if (!this.registeredInlines.has(type)) {
      throw new Error(`Unregistered inline type: ${type}`);
    }
    return this.registeredInlines.get(type)!;
  }

  parse(json: DocumentJSON): Document {
    return new Document(document => json.children.map(blockJSON => {
        const blockClass = this.getBlock(blockJSON.type);
        return new blockClass(document, block => blockJSON.children.map(inlineJSON => {
          const inlineClass = this.getInline(inlineJSON.type);
          return new inlineClass(block, inlineJSON.content);
        }));
      })
    );
  }
}
