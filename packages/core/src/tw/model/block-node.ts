import { IDocModelNode } from 'tw/model/doc-node';
import { IInlineModelNode } from 'tw/model/inline-node';
import { IModelNode, IModelPosition, ModelNode, ModelPosition } from 'tw/model/node';
import { CloseToken, IToken, OpenToken } from 'tw/state/token';

export interface IBlockModelNode<TAttributes>
    extends IModelNode<TAttributes, IDocModelNode<any>, IInlineModelNode<any>> {}

export abstract class BlockModelNode<TAttributes>
    extends ModelNode<TAttributes, IDocModelNode<any>, IInlineModelNode<any>>
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
            this.size = this.getChildNodes().reduce((size, childNode) => size + childNode.getSize(), 2);
        }
        return this.size!;
    }

    resolvePosition(offset: number, depth: number): IModelPosition {
        let cumulatedOffset = 1;
        const childNodes = this.getChildNodes();
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
        tokens.push(new OpenToken(this.getType(), this.getId(), this.getAttributes()));
        this.getChildNodes().forEach(childNode => {
            tokens.push(...childNode.toTokens());
        });
        tokens.push(new CloseToken());
        return tokens;
    }
}
