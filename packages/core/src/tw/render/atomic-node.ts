import { IInlineRenderNode } from './inline-node';
import { IRenderNode, IRenderPosition, RenderNode, RenderPosition } from './node';

export interface IAtomicRenderNode<TStyle = {}> extends IRenderNode<TStyle, IInlineRenderNode, never> {
    isBreakable(): boolean;
}

export abstract class AtomicRenderNode<TStyle> extends RenderNode<TStyle, IInlineRenderNode, never>
    implements IAtomicRenderNode {
    abstract isBreakable(): boolean;

    isRoot() {
        return false;
    }

    isLeaf() {
        return true;
    }

    resolvePosition(offset: number, depth: number): IRenderPosition {
        return new RenderPosition(this, depth, offset);
    }

    convertOffsetToModelOffset(offset: number) {
        return offset;
    }

    convertModelOffsetToOffset(modelOffset: number) {
        return modelOffset;
    }
}
