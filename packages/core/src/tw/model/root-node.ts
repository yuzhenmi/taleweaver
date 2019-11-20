import { IBlockModelNode } from 'tw/model/block-node';
import { IModelNode, IModelPosition, ModelNode, ModelPosition } from 'tw/model/node';
import { CLOSE_TOKEN, IToken } from 'tw/state/token';

export interface IRootModelNode<TAttributes> extends IModelNode<TAttributes, never, IBlockModelNode<any>> {}

export abstract class RootModelNode<TAttributes> extends ModelNode<TAttributes, never, IBlockModelNode<any>>
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
            this.size = this.getChildNodes().reduce((size, childNode) => size + childNode.getSize(), 2);
        }
        return this.size!;
    }

    resolvePosition(offset: number): IModelPosition {
        let cumulatedOffset = 1;
        const childNodes = this.getChildNodes();
        for (let n = 0, nn = childNodes.length; n < nn; n++) {
            const child = childNodes[n];
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
            elementId: this.getElementId(),
            type: this.getType(),
            id: this.getId(),
            attributes: this.getAttributes(),
        });
        this.getChildNodes().forEach(childNode => {
            tokens.push(...childNode.toTokens());
        });
        tokens.push(CLOSE_TOKEN);
        return tokens;
    }
}
