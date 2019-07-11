import Editor from '../Editor';
import Doc from '../model/DocModelNode';
import RootNode from '../tree/RootNode';
import BlockRenderNode from './BlockRenderNode';
import RenderNode, { ResolvedPosition } from './RenderNode';

export type Child = BlockRenderNode;

export default class DocRenderNode extends RenderNode implements RootNode {
  protected children: Child[];

  constructor(editor: Editor, id: string) {
    super(editor, id);
    this.children = [];
  }

  getType(): string {
    return 'DocRenderNode';
  }

  getVersion(): number {
    return this.version;
  }

  insertChild(child: Child, offset: number | null = null) {
    child.setParent(this);
    if (offset === null) {
      this.children.push(child);
    } else {
      this.children.splice(offset, 0, child);
    }
    this.clearCache();
  }

  deleteChild(child: Child) {
    const childOffset = this.children.indexOf(child);
    if (childOffset < 0) {
      throw new Error('Cannot delete child, child not found.');
    }
    child.setParent(null);
    this.children.splice(childOffset, 1);
    this.clearCache();
  }

  getChildren(): Child[] {
    return this.children;
  }

  getSelectableSize() {
    if (this.selectableSize === undefined) {
      let selectableSize = 0;
      this.children.forEach(child => {
        selectableSize += child.getSelectableSize();
      });
      this.selectableSize = selectableSize;
    }
    return this.selectableSize;
  }

  getModelSize(): number {
    if (this.modelSize === undefined) {
      let modelSize = 2;
      this.children.forEach(child => {
        modelSize += child.getModelSize();
      });
      this.modelSize = modelSize;
    }
    return this.modelSize;
  }

  convertSelectableOffsetToModelOffset(selectableOffset: number): number {
    let cumulatedSelectableOffset = 0;
    let cumulatedModelOffset = 1;
    for (let n = 0, nn = this.children.length; n < nn; n++) {
      const child = this.children[n];
      const childSelectableOffset = child.getSelectableSize();
      if (cumulatedSelectableOffset + childSelectableOffset > selectableOffset) {
        return cumulatedModelOffset + child.convertSelectableOffsetToModelOffset(selectableOffset - cumulatedSelectableOffset);
      }
      cumulatedSelectableOffset += childSelectableOffset;
      cumulatedModelOffset += child.getModelSize();
    }
    throw new Error(`Selectable offset ${selectableOffset} is out of range.`);
  }

  resolveSelectableOffset(selectableOffset: number): ResolvedPosition {
    let cumulatedOffset = 0;
    for (let n = 0, nn = this.children.length; n < nn; n++) {
      const child = this.children[n];
      const childSize = child.getSelectableSize();
      if (cumulatedOffset + childSize > selectableOffset) {
        const resolvedPosition: ResolvedPosition = {
          renderNode: this,
          depth: 0,
          offset: selectableOffset,
          parent: null,
          child: null,
        };
        const childResolvedPosition = child.resolveSelectableOffset(selectableOffset - cumulatedOffset, 1);
        resolvedPosition.child = childResolvedPosition;
        childResolvedPosition.parent = resolvedPosition;
        return resolvedPosition;
      }
      cumulatedOffset += childSize;
    }
    throw new Error(`Selectable offset ${selectableOffset} is out of range.`);
  }

  onModelUpdated(element: Doc) {
    this.id = element.getID();
    this.clearCache();
  }
}
