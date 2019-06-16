import Editor from '../Editor';
import Node from '../tree/Node';

export default abstract class LayoutNode implements Node {
  protected editor: Editor;
  protected id: string;
  protected version: number;
  protected selectableSize?: number;
  protected deleted: boolean = false;

  constructor(editor: Editor, id: string) {
    this.editor = editor;
    this.id = id;
    this.version = 0;
  }

  getID() {
    return this.id;
  }

  abstract setVersion(version: number): void;

  getVersion() {
    return this.version;
  }

  markAsDeleted() {
    this.deleted = true;
  }

  isDeleted() {
    return this.deleted;
  }

  abstract getSelectableSize(): number;

  abstract getWidth(): number;

  abstract getHeight(): number;

  abstract getPaddingTop(): number;

  abstract getPaddingBottom(): number;

  abstract getPaddingLeft(): number;

  abstract getPaddingRight(): number;

  protected clearCache() {
    this.selectableSize = undefined;
  }
}
