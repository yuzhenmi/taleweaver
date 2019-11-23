import { IBlockModelNode } from 'tw/model/block-node';
import { IModelNode, IModelPosition, ModelNode, ModelPosition } from 'tw/model/node';
import { CLOSE_TOKEN, IToken } from 'tw/state/token';

export interface IRootModelNode<TAttributes = any> extends IModelNode<TAttributes, never, IBlockModelNode> {}

export abstract class RootModelNode<TAttributes> extends ModelNode<TAttributes, never, IBlockModelNode>
    implements IRootModelNode<TAttributes> {
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
        const children = this.getChildren();
        for (let n = 0, nn = children.length; n < nn; n++) {
            const child = children[n];
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

    clearCache() {
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
