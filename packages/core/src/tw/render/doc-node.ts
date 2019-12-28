import { IBlockRenderNode } from './block-node';
import { IRenderNode, IRenderPosition, RenderNode, RenderPosition } from './node';

export interface IDocRenderNode<TStyle = {}> extends IRenderNode<TStyle, never, IBlockRenderNode> {}

export abstract class DocRenderNode<TStyle> extends RenderNode<TStyle, never, IBlockRenderNode>
    implements IDocRenderNode<TStyle> {
    protected size?: number;
    protected modelSize?: number;

    isRoot() {
        return true;
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

    resolvePosition(offset: number): IRenderPosition {
        let cumulatedOffset = 0;
        for (let child of this.getChildren()) {
            const childSize = child.getSize();
            if (cumulatedOffset + childSize > offset) {
                const position = new RenderPosition(this, 0, offset);
                const childPosition = child.resolvePosition(offset - cumulatedOffset, 1);
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
