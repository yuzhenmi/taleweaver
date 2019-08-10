import InlineNode from './InlineRenderNode';
import RenderNode from './RenderNode';
import RenderPosition from './RenderPosition';

export type ParentNode = InlineNode;

export default abstract class AtomicRenderNode extends RenderNode<ParentNode, never> {
    abstract getBreakable(): boolean;

    isRoot() {
        return false;
    }

    isLeaf() {
        return true;
    }

    getModelSize() {
        return this.getSize();
    }

    convertOffsetToModelOffset(offset: number): number {
        return offset;
    }

    resolvePosition(offset: number, depth: number): RenderPosition {
        return new RenderPosition(this, depth, offset);
    }
}
