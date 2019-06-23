import Editor from '../Editor';
import Node from '../tree/Node';

export default abstract class LayoutNode implements Node {
  protected editor: Editor;
  protected id: string;
  protected version: number = 0;
  protected selectableSize?: number;
  protected deleted: boolean = false;

  constructor(editor: Editor, id: string) {
    this.editor = editor;
    this.id = id;
  }

  getID() {
    return this.id;
  }

  getVersion() {
    return this.version;
  }

  bumpVersion() {
    this.version++;
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
