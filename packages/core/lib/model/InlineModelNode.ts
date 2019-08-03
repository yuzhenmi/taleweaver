import CloseTagToken from '../state/CloseTagToken';
import OpenTagToken from '../state/OpenTagToken';
import Token from '../state/Token';
import BlockModelNode from './BlockModelNode';
import ModelNode from './ModelNode';
import ModelPosition from './ModelPosition';

type ParentNode = BlockModelNode<any>;

export default abstract class InlineModelNode<A> extends ModelNode<A, ParentNode, never> {
    protected content: string = '';
    protected size?: number;

    isRoot() {
        return false;
    }

    isLeaf() {
        return true;
    }

    setContent(content: string) {
        this.content = content;
        this.clearCache();
    }

    getContent() {
        return this.content;
    }

    getSize() {
        if (this.size === undefined) {
            return 2 + this.content.length;
        }
        return this.size;
    }

    toTokens() {
        const tokens: Token[] = [];
        tokens.push(new OpenTagToken(this.getType(), this.getID(), this.getAttributes()));
        tokens.push(...this.content.split(''));
        tokens.push(new CloseTagToken());
        return tokens;
    }

    resolvePosition(offset: number, depth: number) {
        if (offset >= this.getSize()) {
            throw new Error(`Offset ${offset} is out of range.`);
        }
        const position = new ModelPosition(this, depth, offset);
        return position;
    }

    clearCache() {
        this.size = undefined;
        const parent = this.getParent();
        if (parent) {
            parent.clearCache();
        }
    }
};
