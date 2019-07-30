import InlineNode from './InlineRenderNode';
import RenderNode, { RenderPosition } from './RenderNode';

export type ParentNode = InlineNode;

export default abstract class AtomicRenderNode extends RenderNode<ParentNode, never> {
    abstract getBreakable(): boolean;

    isRoot() {
        return true;
    }

    isLeaf() {
        return false;
    }

    getModelSize() {
        return this.getSize();
    }

    convertOffsetToModelOffset(offset: number): number {
        return offset;
    }

    resolvePosition(offset: number, depth: number): RenderPosition {
        return {
            node: this,
            depth,
            offset,
        };
    }
}
