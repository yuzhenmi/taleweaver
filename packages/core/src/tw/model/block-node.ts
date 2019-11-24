import { IDocModelNode } from 'tw/model/doc-node';
import { IInlineModelNode } from 'tw/model/inline-node';
import { IModelNode, IModelPosition, ModelNode, ModelPosition } from 'tw/model/node';
import { CLOSE_TOKEN, IToken } from 'tw/state/token';

export interface IBlockModelNode<TAttributes = {}> extends IModelNode<TAttributes, IDocModelNode, IInlineModelNode> {}

export abstract class BlockModelNode<TAttributes> extends ModelNode<TAttributes, IDocModelNode, IInlineModelNode>
    implements IBlockModelNode<TAttributes> {
    protected size?: number;

    isRoot() {
        return false;
    }

    isLeaf() {
        return false;
    }

    getSize() {
        if (this.size === undefined) {
            this.size = this.getChildren().reduce((size, childNode) => size + childNode.getSize(), 2);
        }
        return this.size!;
    }

    resolvePosition(offset: number, depth: number): IModelPosition {
        let cumulatedOffset = 1;
        const childNodes = this.getChildren();
        for (let n = 0, nn = childNodes.length; n < nn; n++) {
            const childNode = childNodes[n];
            const childSize = childNode.getSize();
            if (cumulatedOffset + childSize > offset) {
                const position = new ModelPosition(this, depth, offset);
                const childPosition = childNode.resolvePosition(offset - cumulatedOffset, depth + 1);
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
        const parent = this.getParent();
        if (parent) {
            parent.clearCache();
        }
    }

    toTokens() {
        const tokens: IToken[] = [];
        tokens.push({
            componentId: this.getComponentId(),
            partId: this.getPartId(),
            id: this.getId(),
            attributes: this.getAttributes(),
        });
        this.getChildren().forEach(childNode => {
            tokens.push(...childNode.toTokens());
        });
        tokens.push(CLOSE_TOKEN);
        return tokens;
    }
}
