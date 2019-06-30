import Editor from '../Editor';
import generateID from '../utils/generateID';
import BranchNode from '../tree/BranchNode';
import BlockElement from '../model/BlockElement';
import RenderNode from './RenderNode';
import DocRenderNode from './DocRenderNode';
import InlineRenderNode from './InlineRenderNode';
import TextInlineRenderNode from './TextInlineRenderNode';
import TextAtomicRenderNode from './TextAtomicRenderNode';
import { DEFAULT_STYLE } from '../config/TextConfig';

export type Parent = DocRenderNode;
export type Child = InlineRenderNode;

export default abstract class BlockRenderNode extends RenderNode implements BranchNode {
  protected parent: Parent | null = null;
  protected children: Child[] = [];
  protected lineBreakInlineRenderNode: InlineRenderNode;

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

  onModelUpdated(element: BlockElement) {
    this.selectableSize = undefined;
    this.modelSize = undefined;
  }

  getSelectableSize() {
    if (this.selectableSize === undefined) {
      let selectableSize = 1;
      this.children.forEach(child => {
        selectableSize += child.getSelectableSize();
      });
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

  buildLineBreakInlineRenderNode(): InlineRenderNode {
    const inlineRenderNode = new TextInlineRenderNode(this.editor, generateID());
    inlineRenderNode.setTextStyle(DEFAULT_STYLE);
    inlineRenderNode.bumpVersion();
    const atomicRenderNode = new TextAtomicRenderNode(this.editor, generateID(), '\n', true, DEFAULT_STYLE);
    atomicRenderNode.bumpVersion();
    inlineRenderNode.insertChild(atomicRenderNode);
    return inlineRenderNode;
  }

  getLineBreakInlineRenderNode() {
    return this.lineBreakInlineRenderNode;
  }
}
