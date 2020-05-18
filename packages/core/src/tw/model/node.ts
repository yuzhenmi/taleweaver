import { CLOSE_TOKEN, IToken } from '../state/token';
import { INode, Node } from '../tree/node';
import { IPosition, Position } from '../tree/position';

export interface IModelNode<TAttributes extends {}> extends INode<IModelNode<TAttributes>> {
    readonly componentId: string;
    readonly partId: string | null;
    readonly attributes: TAttributes;
    readonly text: string;
    readonly size: number;
    readonly needRender: boolean;

    clearNeedRender(): void;
    resolvePosition(offset: number): IModelPosition;
    toTokens(): IToken[];
    toDOM(from: number, to: number): HTMLElement;
}

export interface IModelPosition extends IPosition<IModelNode<any>> {}

export abstract class ModelNode<TAttributes extends {}> extends Node<IModelNode<TAttributes>>
    implements IModelNode<TAttributes> {
    abstract get partId(): string | null;

    abstract toDOM(from: number, to: number): HTMLElement;

    protected internalText: string;
    protected internalSize?: number;
    protected internalNeedRender = true;

    constructor(readonly componentId: string, id: string, text: string, readonly attributes: TAttributes) {
        super(id);
        this.internalText = text;
        this.onDidUpdateNode(() => {
            this.internalSize = undefined;
            this.internalNeedRender = true;
        });
    }

    get text() {
        return this.internalText;
    }

    get size() {
        if (this.internalSize === undefined) {
            if (this.leaf) {
                this.internalSize = 2 + this.text.length;
            }
            this.internalSize = this.children.reduce((size, child) => size + child.size, 2);
        }
        return this.internalSize;
    }

    get needRender() {
        return this.internalNeedRender;
    }

    clearNeedRender() {
        this.internalNeedRender = false;
    }

    resolvePosition(offset: number): IModelPosition {
        if (offset < 0 || offset >= this.size) {
            throw new Error(`Offset ${offset} is out of range.`);
        }
        const layers: Array<{
            node: IModelNode<any>;
            offset: number;
        }> = [{ node: this, offset }];
        {
            let node: IModelNode<any> = this;
            let parent = this.parent;
            while (parent) {
                let parentOffset = 0;
                let previousSibling = node.previousSibling;
                while (previousSibling) {
                    parentOffset += previousSibling.size;
                    previousSibling = node.previousSibling;
                }
                layers.unshift({ node: parent, offset: parentOffset + layers[0].offset });
                node = parent;
                parent = node.parent;
            }
        }
        {
            let node: IModelNode<any> | null = this;
            while (node && !node.leaf) {
                const lastLayer = layers[layers.length - 1];
                let cumulatedOffset = 1;
                let child: IModelNode<any> | null = null;
                for (let n = 0, nn = node.children.length; n < nn; n++) {
                    child = node.children.at(n);
                    const childSize = child.size;
                    if (cumulatedOffset + childSize > lastLayer.offset) {
                        layers.push({ node: child, offset: lastLayer.offset - cumulatedOffset });
                        break;
                    }
                    cumulatedOffset += childSize;
                    node = child;
                }
            }
        }
        const buildPosition = (parent: IModelPosition | null, depth: number): IModelPosition => {
            const { node, offset } = layers[depth];
            return new ModelPosition(node, depth, offset, parent, (parent) =>
                depth < layers.length ? buildPosition(parent, depth + 1) : null,
            );
        };
        return buildPosition(null, 0);
    }

    toTokens() {
        const tokens: IToken[] = [];
        tokens.push({
            componentId: this.componentId,
            partId: this.partId,
            id: this.id,
            attributes: this.attributes,
        });
        if (this.leaf) {
            tokens.push(...this.text.split(''));
        } else {
            this.children.forEach((child) => {
                tokens.push(...child.toTokens());
            });
        }
        tokens.push(CLOSE_TOKEN);
        return tokens;
    }
}

export class ModelPosition extends Position<IModelNode<any>> implements IModelPosition {}
