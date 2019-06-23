import Editor from '../Editor';
import generateID from '../utils/generateID';
import TreeNode from '../tree/Node';
import Token from '../token/Token';
import Attributes from '../token/Attributes';

export interface DOMAttributes {
  [key: string]: any;
}

export interface ResolvedPosition {
  element: Element;
  depth: number;
  offset: number;
  parent: ResolvedPosition | null;
  child: ResolvedPosition | null;
}

export default abstract class Element implements TreeNode {
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

  getVersion(): number {
    return this.version;
  }

  bumpVersion() {
    this.version++;
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
