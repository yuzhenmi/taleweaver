import { IInlineRenderNode } from 'tw/render/inline-node';
import { IRenderNode, IRenderPosition, RenderNode, RenderPosition } from 'tw/render/node';

export interface IAtomicRenderNode extends IRenderNode<IInlineRenderNode, never> {}

export abstract class AtomicRenderNode extends RenderNode<IInlineRenderNode, never> implements IAtomicRenderNode {
    isRoot() {
        return false;
    }

    isLeaf() {
        return true;
    }

    resolvePosition(offset: number, depth: number): IRenderPosition {
        return new RenderPosition(this, depth, offset);
    }

    convertOffsetToModelOffset(offset: number): number {
        return offset;
    }
}
