import Editor from '../Editor';
import LayoutNode from '../layout/LayoutNode';

export default abstract class ViewNode {
  protected editor: Editor;
  protected id: string;
  protected version: number = 0;
  protected selectableSize?: number;

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

  abstract getDOMContainer(): HTMLElement;

  getSelectableSize() {
    if (this.selectableSize === undefined) {
      throw new Error('View node has not yet been initialized with selectable size.');
    }
    return this.selectableSize;
  }

  abstract onLayoutUpdated(layoutNode: LayoutNode): void;

  abstract onDeleted(): void;

  abstract resolveSelectableOffsetToNodeOffset(selectableOffset: number): [Node, number];
}
