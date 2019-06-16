import Editor from '../Editor';
import Node from '../tree/Node';

export default abstract class RenderNode implements Node {
  protected editor: Editor;
  protected id: string;
  protected version: number;
  protected selectableSize?: number;
  protected modelSize?: number;

  constructor(editor: Editor, id: string) {
    this.editor = editor;
    this.id = id;
    this.version = 0;
  }

  abstract getType(): string;

  getID(): string {
    return this.id;
  }

  abstract setVersion(version: number): void;

  getVersion() {
    return this.version;
  }

  abstract getSelectableSize(): number;

  abstract getModelSize(): number;

  abstract convertSelectableOffsetToModelOffset(selectableOffset: number): number;

  protected clearCache() {
    this.selectableSize = undefined;
    this.modelSize = undefined;
  }
}
