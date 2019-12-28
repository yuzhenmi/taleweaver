import { CLOSE_TOKEN, IToken } from '../state/token';
import { IBlockModelNode } from './block-node';
import { IModelNode, IModelPosition, ModelNode, ModelPosition } from './node';

export interface IInlineModelNode<TAttributes = {}> extends IModelNode<TAttributes, IBlockModelNode, never> {
    setContent(content: string): void;
    getContent(): string;
}

export abstract class InlineModelNode<TAttributes> extends ModelNode<TAttributes, IBlockModelNode, never> {
    protected content = '';
    protected size?: number;

    constructor(componentId: string, id: string, attributes: TAttributes) {
        super(componentId, id, attributes);
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

    clearOwnCache() {
        this.size = undefined;
    }

    onDidUpdate(updatedNode: this) {
        super.onDidUpdate(updatedNode);
        const oldContent = this.content;
        const newContent = updatedNode.getContent();
        if (oldContent === newContent) {
            return;
        }
        this.content = updatedNode.getContent();
        this.clearCache();
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
