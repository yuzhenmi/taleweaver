import { CLOSE_TOKEN, IToken } from '../state/token';
import { IDocModelNode } from './doc-node';
import { IInlineModelNode } from './inline-node';
import { IModelNode, IModelPosition, ModelNode, ModelPosition } from './node';

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
        for (let child of this.getChildren()) {
            const childSize = child.getSize();
            if (cumulatedOffset + childSize > offset) {
                const position = new ModelPosition(this, depth, offset);
                const childPosition = child.resolvePosition(offset - cumulatedOffset, depth + 1);
                position.setChild(childPosition);
                childPosition.setParent(position);
                return position;
            }
            cumulatedOffset += childSize;
        }
        if (offset < this.getSize()) {
            return new ModelPosition(this, depth, offset);
        }
        throw new Error(`Offset ${offset} is out of range.`);
    }

    clearOwnCache() {
        this.size = undefined;
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
