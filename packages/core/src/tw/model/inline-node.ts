import { IComponent } from 'tw/component/component';
import { IBlockModelNode } from 'tw/model/block-node';
import { IModelNode, IModelPosition, ModelNode, ModelPosition } from 'tw/model/node';
import { CLOSE_TOKEN, IToken } from 'tw/state/token';

export interface IInlineModelNode<TAttributes = any> extends IModelNode<TAttributes, IBlockModelNode, never> {
    setContent(content: string): void;
    getContent(): string;
}

export abstract class InlineModelNode<TAttributes> extends ModelNode<TAttributes, IBlockModelNode, never> {
    protected content = '';
    protected size?: number;

    constructor(component: IComponent, id: string, attributes: TAttributes) {
        super(component, id, attributes);
    }

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
        tokens.push({
            componentId: this.getComponentId(),
            partId: this.getPartId(),
            id: this.getId(),
            attributes: this.getAttributes(),
        });
        tokens.push(...this.content.split(''));
        tokens.push(CLOSE_TOKEN);
        return tokens;
    }
}
