import Node from '../tree/Node';
import Token from '../token/Token';
import Attributes from '../token/Attributes';
import Editor from '../Editor';

export default abstract class Element implements Node {
  static compatibleHTMLTagNames: string[] = [];
  static fromHTMLElement($element: HTMLElement): Element {
    throw new Error('Element class must implement static method fromHTMLElement.');
  }

  protected editor: Editor;
  protected id?: string;
  protected version: number = 0;
  protected size?: number;

  constructor(editor: Editor) {
    this.editor = editor;
  }

  abstract getType(): string;

  setID(id: string) {
    this.id = id;
  }

  getID() {
    if (!this.id) {
      throw new Error('No ID has been set.');
    }
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
