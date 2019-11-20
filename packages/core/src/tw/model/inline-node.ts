import { IBlockModelNode } from 'tw/model/block-node';
import { IModelNode, IModelPosition, ModelNode, ModelPosition } from 'tw/model/node';
import { CloseToken, IToken, OpenToken } from 'tw/state/token';

export interface IInlineModelNode<TAttributes> extends IModelNode<TAttributes, IBlockModelNode<any>, never> {
    setContent(content: string): void;
    getContent(): string;
}

export abstract class InlineModelNode<TAttributes> extends ModelNode<TAttributes, IBlockModelNode<any>, never> {
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

    resolvePosition(offset: number, depth: number): IModelPosition {
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

    toTokens() {
        const tokens: IToken[] = [];
        tokens.push(new OpenToken(this.getType(), this.getId(), this.getAttributes()));
        tokens.push(...this.content.split(''));
        tokens.push(new CloseToken());
        return tokens;
    }

    onUpdated(updatedNode: this) {
        this.content = updatedNode.getContent();
        super.onUpdated(updatedNode);
    }
}
