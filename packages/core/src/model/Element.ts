import Editor from '../Editor';
import generateID from '../utils/generateID';
import TreeNode from '../tree/Node';
import Token from '../token/Token';
import Attributes from '../token/Attributes';

export interface Segment {
  nodes: Array<{
    name: string;
    attributes: {
      [key: string]: any;
    };
    ref: Node;
  }>;
  content: string | null;
}

export interface DOMAttributes {
  [key: string]: any;
}

export default abstract class Element implements TreeNode {
  static fromSegment(editor: Editor, segment: Segment): [Element | null, Node | null] {
    throw new Error('Element class must implement static method fromSegment.');
  }

  protected editor: Editor;
  protected id: string;
  protected version: number = 0;
  protected size?: number;

  constructor(editor: Editor) {
    this.editor = editor;
    this.id = generateID();
  }

  abstract getType(): string;

  setID(id: string) {
    this.id = id;
  }

  getID() {
    return this.id;
  }

  abstract setVersion(version: number): void;

  getVersion(): number {
    return this.version;
  }

  abstract getSize(): number;

  abstract getAttributes(): Attributes;

  abstract toHTML(from: number, to: number): HTMLElement;

  abstract toTokens(): Token[];

  abstract onStateUpdated(attributes: Attributes): boolean;

  protected clearCache() {
    this.size = undefined;
  }
}
