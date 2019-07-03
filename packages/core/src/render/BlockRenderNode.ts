import Editor from '../Editor';
import generateID from '../utils/generateID';
import BranchNode from '../tree/BranchNode';
import BlockElement from '../model/BlockElement';
import RenderNode, { ResolvedPosition } from './RenderNode';
import DocRenderNode from './DocRenderNode';
import InlineRenderNode from './InlineRenderNode';
import LineBreakInlineRenderNode from './LineBreakInlineRenderNode';

export type Parent = DocRenderNode;
export type Child = InlineRenderNode;

export default abstract class BlockRenderNode extends RenderNode implements BranchNode {
  protected parent: Parent | null = null;
  protected children: Child[] = [];
  protected lineBreakInlineRenderNode: LineBreakInlineRenderNode;

  constructor(editor: Editor, id: string) {
    super(editor, id);
    this.lineBreakInlineRenderNode = this.buildLineBreakInlineRenderNode();
  }

  getVersion() {
    return this.version;
  }

  setParent(parent: Parent | null) {
    this.parent = parent;
  }

  getParent() {
    if (!this.parent) {
      throw new Error('No parent has been set.');
    }
    return this.parent;
  }

  getChildren() {
    return this.children;
  }

  insertChild(child: Child, offset: number | null = null) {
    child.setParent(this);
    if (offset === null) {
      this.children.push(child);
    } else {
      this.children.splice(offset, 0, child);
    }
    this.selectableSize = undefined;
    this.modelSize = undefined;
  }

  deleteChild(child: Child) {
    const childOffset = this.children.indexOf(child);
    if (childOffset < 0) {
      throw new Error('Cannot delete child, child not found.');
    }
    child.setParent(null);
    this.children.splice(childOffset, 1);
    this.selectableSize = undefined;
    this.modelSize = undefined;
  }

  getPreviousSibling() {
    const siblings = this.getParent().getChildren();
    const offset = siblings.indexOf(this);
    if (offset < 0) {
      throw new Error(`Block render node is not found in parent.`);
    }
    if (offset > 0) {
      return siblings[offset - 1];
    }
    return null;
  }

  getNextSibling() {
    const siblings = this.getParent().getChildren();
    const offset = siblings.indexOf(this);
    if (offset < 0) {
      throw new Error(`Block render node is not found in parent.`);
    }
    if (offset < siblings.length - 1) {
      return siblings[offset + 1];
    }
    return null;
  }

  onModelUpdated(element: BlockElement) {
    this.selectableSize = undefined;
    this.modelSize = undefined;
  }

  getSelectableSize() {
    if (this.selectableSize === undefined) {
      let selectableSize = 0;
      this.children.forEach(child => {
        selectableSize += child.getSelectableSize();
      });
      selectableSize += this.lineBreakInlineRenderNode.getSelectableSize();
      this.selectableSize = selectableSize;
    }
    return this.selectableSize;
  }

  getModelSize() {
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
    if (cumulatedSelectableOffset === selectableOffset) {
      return this.convertSelectableOffsetToModelOffset(selectableOffset - 1) + 1;
    }
    throw new Error(`Selectable offset ${selectableOffset} is out of range.`);
  }

  resolveSelectableOffset(selectableOffset: number, depth: number) {
    let cumulatedOffset = 0;
    for (let n = 0, nn = this.children.length; n < nn; n++) {
      const child = this.children[n];
      const childSize = child.getSelectableSize();
      if (cumulatedOffset + childSize > selectableOffset) {
        const resolvedPosition: ResolvedPosition = {
          renderNode: this,
          depth,
          offset: selectableOffset,
          parent: null,
          child: null,
        };
        const childResolvedPosition = child.resolveSelectableOffset(selectableOffset - cumulatedOffset, depth + 1);
        resolvedPosition.child = childResolvedPosition;
        childResolvedPosition.parent = resolvedPosition;
        return resolvedPosition;
      }
      cumulatedOffset += childSize;
    }
    if (cumulatedOffset === selectableOffset) {
      return this.lineBreakInlineRenderNode.resolveSelectableOffset(0, depth + 1);
    }
    throw new Error(`Selectable offset ${selectableOffset} is out of range.`);
  }

  buildLineBreakInlineRenderNode(): LineBreakInlineRenderNode {
    const inlineRenderNode = new LineBreakInlineRenderNode(this.editor, generateID());
    inlineRenderNode.setParent(this);
    inlineRenderNode.bumpVersion();
    return inlineRenderNode;
  }

  getLineBreakInlineRenderNode() {
    return this.lineBreakInlineRenderNode;
  }

  bumpVersion() {
    super.bumpVersion();
    this.lineBreakInlineRenderNode.bumpVersion();
  }
}
