import { IAtomicRenderNode } from './atomic-node';
import { IBlockRenderNode } from './block-node';
import { IRenderNode, IRenderPosition, RenderNode, RenderPosition } from './node';

export interface IInlineRenderNode<TStyle = {}> extends IRenderNode<TStyle, IBlockRenderNode, IAtomicRenderNode> {}

export abstract class InlineRenderNode<TStyle> extends RenderNode<TStyle, IBlockRenderNode, IAtomicRenderNode>
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
            this.size = this.getChildren().reduce((size, child) => size + child.getSize(), 0);
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
        for (let child of this.getChildren()) {
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

    clearOwnCache() {
        this.size = undefined;
        this.modelSize = undefined;
    }

    convertOffsetToModelOffset(offset: number): number {
        let cumulatedSize = 0;
        let cumulatedModelSize = 1;
        for (let child of this.getChildren()) {
            const childSize = child.getSize();
            if (cumulatedSize + childSize > offset) {
                return cumulatedModelSize + child.convertOffsetToModelOffset(offset - cumulatedSize);
            }
            cumulatedSize += childSize;
            cumulatedModelSize += child.getModelSize();
        }
        throw new Error(`Offset ${offset} is out of range.`);
    }

    convertModelOffsetToOffset(modelOffset: number): number {
        let cumulatedModelSize = 1;
        let cumulatedSize = 0;
        for (let child of this.getChildren()) {
            const childModelSize = child.getModelSize();
            if (cumulatedModelSize + childModelSize > modelOffset) {
                return cumulatedSize + child.convertModelOffsetToOffset(modelOffset - cumulatedModelSize);
            }
            cumulatedModelSize += childModelSize;
            cumulatedSize += child.getSize();
        }
        throw new Error(`Model offset ${modelOffset} is out of range.`);
    }
}
