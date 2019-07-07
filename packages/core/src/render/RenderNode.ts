import Editor from '../Editor';
import Node from '../tree/Node';

export interface ResolvedPosition {
  renderNode: RenderNode;
  depth: number;
  offset: number;
  parent: ResolvedPosition | null;
  child: ResolvedPosition | null;
}

export default abstract class RenderNode implements Node {
  protected editor: Editor;
  protected id: string;
  protected version: number = 0;
  protected size?: number;
  protected modelSize?: number;

  constructor(editor: Editor, id: string) {
    this.editor = editor;
    this.id = id;
  }

  abstract getType(): string;

  getID(): string {
    return this.id;
  }

  getVersion() {
    return this.version;
  }

  bumpVersion() {
    this.version++;
  }

  abstract getSize(): number;

  abstract getModelSize(): number;

  abstract getModelOffset(offset: number): number;

  protected clearCache() {
    this.size = undefined;
    this.modelSize = undefined;
  }
}
