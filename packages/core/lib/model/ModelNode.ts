import Editor from '../Editor';
import { Attributes } from '../state/OpenTagToken';
import Token from '../state/Token';
import Node from '../tree/Node';
import generateID from '../utils/generateID';

export interface DOMAttributes {
    [key: string]: any;
}

export type AnyModelNode = ModelNode<any, any, any>;

export default abstract class ModelNode<A extends Attributes, P extends AnyModelNode, C extends AnyModelNode> extends Node<P, C> {
    abstract getType(): string;
    abstract getSize(): number;
    abstract clearCache(): void;
    abstract toHTML(from: number, to: number): HTMLElement;
    abstract toTokens(): Token[];

    protected editor: Editor;
    protected id: string;
    protected attributes: A;

    constructor(editor: Editor, attributes: A) {
        super();
        this.editor = editor;
        this.id = attributes.id === undefined ? generateID() : attributes.id;
        this.attributes = attributes;
    }

    appendChild(child: C) {
        super.appendChild(child);
        this.clearCache();
    }

    insertBefore(child: C, beforeChild: C) {
        super.insertBefore(child, beforeChild);
        this.clearCache();
    }

    removeChild(child: C) {
        super.removeChild(child);
        this.clearCache();
    }

    getID() {
        return this.id;
    }

    getAttributes() {
        return this.attributes;
    }

    clone() {
        const { id, ...attributes } = this.attributes;
        return new (this.constructor(this.editor, attributes));
    }

    onUpdated(updatedNode: this) {
        this.attributes = updatedNode.attributes;
        super.onUpdated(updatedNode);
        this.clearCache();
    };
}
