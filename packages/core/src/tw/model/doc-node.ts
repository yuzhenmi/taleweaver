import { CLOSE_TOKEN, IToken } from '../state/token';
import { IBlockModelNode } from './block-node';
import { IModelNode, IModelPosition, ModelNode, ModelPosition } from './node';

export interface IDocModelNode<TAttributes = {}> extends IModelNode<TAttributes, never, IBlockModelNode> {}

export abstract class DocModelNode<TAttributes> extends ModelNode<TAttributes, never, IBlockModelNode>
    implements IDocModelNode<TAttributes> {
    protected size?: number;

    isRoot() {
        return true;
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

    resolvePosition(offset: number): IModelPosition {
        let cumulatedOffset = 1;
        for (let child of this.getChildren()) {
            const childSize = child.getSize();
            if (cumulatedOffset + childSize > offset) {
                const position = new ModelPosition(this, 0, offset);
                const childPosition = child.resolvePosition(offset - cumulatedOffset, 1);
                position.setChild(childPosition);
                childPosition.setParent(position);
                return position;
            }
            cumulatedOffset += childSize;
        }
        if (offset < this.getSize()) {
            return new ModelPosition(this, 0, offset);
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
        this.getChildren().forEach(child => {
            tokens.push(...child.toTokens());
        });
        tokens.push(CLOSE_TOKEN);
        return tokens;
    }
}
