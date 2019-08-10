import CloseTagToken from '../state/CloseTagToken';
import OpenTagToken from '../state/OpenTagToken';
import Token from '../state/Token';
import DocNode from './DocModelNode';
import InlineNode from './InlineModelNode';
import ModelNode from './ModelNode';
import ModelPosition from './ModelPosition';

type ParentNode = DocNode;
type ChildNode = InlineNode<any>;

export default abstract class BlockModelNode<A> extends ModelNode<A, ParentNode, ChildNode> {
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

    toTokens() {
        const tokens: Token[] = [];
        tokens.push(new OpenTagToken(this.getType(), this.getID(), this.getAttributes()));
        this.getChildNodes().forEach(childNode => {
            tokens.push(...childNode.toTokens());
        });
        tokens.push(new CloseTagToken());
        return tokens;
    }

    resolvePosition(offset: number, depth: number) {
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
};
