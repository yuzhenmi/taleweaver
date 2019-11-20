import { IBlockModelNode } from 'tw/model/block-node';
import { IModelNode, IModelPosition, ModelNode, ModelPosition } from 'tw/model/node';
import { CloseToken, IToken, OpenToken } from 'tw/state/token';

export interface IDocModelNode<TAttributes> extends IModelNode<TAttributes, never, IBlockModelNode<any>> {}

export interface DocAttributes {}

export class DocModelNode extends ModelNode<DocAttributes, never, IBlockModelNode<any>>
    implements IDocModelNode<DocAttributes> {
    protected size?: number;

    isRoot() {
        return true;
    }

    isLeaf() {
        return false;
    }

    getType() {
        return 'Doc';
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
        tokens.push(new OpenToken(this.getType(), this.getId(), this.getAttributes()));
        this.getChildNodes().forEach(childNode => {
            tokens.push(...childNode.toTokens());
        });
        tokens.push(new CloseToken());
        return tokens;
    }

    toHTML(from: number, to: number) {
        const $element = document.createElement('div');
        let offset = 1;
        const childNodes = this.getChildNodes();
        for (let n = 0, nn = childNodes.length; n < nn && offset < to; n++) {
            const child = childNodes[n];
            const childSize = child.getSize();
            const childFrom = Math.max(0, from - offset);
            const childTo = Math.min(childFrom + childSize, to - offset);
            offset += childSize;
            if (childFrom > childSize || childTo < 0) {
                continue;
            }
            const $childElement = child.toHTML(childFrom, childTo);
            $element.appendChild($childElement);
        }
        return $element;
    }
}
