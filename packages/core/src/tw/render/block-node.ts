import { IDocRenderNode } from 'tw/render/doc-node';
import { IInlineRenderNode } from 'tw/render/inline-node';
import { IRenderNode, IRenderPosition, RenderNode, RenderPosition } from 'tw/render/node';

export interface IBlockRenderNode<TStyle = {}> extends IRenderNode<TStyle, IDocRenderNode, IInlineRenderNode> {}

export abstract class BlockRenderNode<TStyle> extends RenderNode<TStyle, IDocRenderNode, IInlineRenderNode>
    implements IBlockRenderNode<TStyle> {
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
