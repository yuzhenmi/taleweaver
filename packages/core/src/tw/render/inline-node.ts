import { IAtomicRenderNode } from 'tw/render/atomic-node';
import { IBlockRenderNode } from 'tw/render/block-node';
import { IRenderNode, IRenderPosition, RenderNode, RenderPosition } from 'tw/render/node';

export interface IInlineRenderNode extends IRenderNode<IBlockRenderNode, IAtomicRenderNode> {}

export abstract class InlineRenderNode extends RenderNode<IBlockRenderNode, IAtomicRenderNode>
    implements IInlineRenderNode {
    protected size?: number;
    protected modelSize?: number;

    isRoot() {
        return false;
    }

    isLeaf() {
        return false;
    }

    getSize() {
        if (this.size === undefined) {
            this.size = this.getChildren().reduce((size, child) => size + child.getSize(), 2);
        }
        return this.size!;
    }

    getModelSize() {
        if (this.modelSize === undefined) {
            this.modelSize = this.getChildren().reduce((size, childNode) => size + childNode.getModelSize(), 2);
        }
        return this.modelSize!;
    }

    resolvePosition(offset: number, depth: number): IRenderPosition {
        let cumulatedOffset = 0;
        const children = this.getChildren();
        for (let n = 0, nn = children.length; n < nn; n++) {
            const child = children[n];
            const childSize = child.getSize();
            if (cumulatedOffset + childSize > offset) {
                const position = new RenderPosition(this, depth, offset);
                const childPosition = child.resolvePosition(offset - cumulatedOffset, depth + 1);
                position.setChild(childPosition);
                childPosition.setParent(position);
                return position;
            }
            cumulatedOffset += childSize;
        }
        throw new Error(`Offset ${offset} is out of range.`);
    }

    clearCache() {
        this.size = undefined;
    }

    convertOffsetToModelOffset(offset: number): number {
        let cumulatedSize = 0;
        let cumulatedModelSize = 1;
        const children = this.getChildren();
        for (let n = 0, nn = children.length; n < nn; n++) {
            const child = children[n];
            const childSize = child.getSize();
            if (cumulatedSize + childSize > offset) {
                return cumulatedModelSize + child.convertOffsetToModelOffset(offset - cumulatedSize);
            }
            cumulatedSize += childSize;
            cumulatedModelSize += child.getModelSize();
        }
        throw new Error(`Offset ${offset} is out of range.`);
    }
}