import { EventEmitter, IDisposable } from '../event/emitter';
import { IEventListener, IOnEvent } from '../event/listener';
import { INode, Node } from '../tree/node';
import { NodeList } from '../tree/node-list';
import { IPosition, Position } from '../tree/position';
import { ISlice } from './slice';

export interface IDidUpdateModelNodeEvent {}

export interface IModelNode<TAttributes extends {}> extends INode<IModelNode<TAttributes>> {
    readonly componentId: string;
    readonly partId: string | null;
    readonly attributes: TAttributes;
    readonly text: string;
    readonly size: number;
    readonly needRender: boolean;

    clearNeedRender(): void;
    replace(from: number, to: number, slice: ISlice): void;
    resolvePosition(offset: number): IModelPosition;
    toDOM(from: number, to: number): HTMLElement;
    onDidUpdate: IOnEvent<IDidUpdateModelNodeEvent>;
}

export interface IModelPosition extends IPosition<IModelNode<any>> {}

export abstract class ModelNode<TAttributes extends {}> extends Node<IModelNode<TAttributes>>
    implements IModelNode<TAttributes> {
    abstract get partId(): string | null;

    abstract toDOM(from: number, to: number): HTMLElement;

    protected internalText: string;
    protected internalSize?: number;
    protected internalNeedRender = true;
    protected childDidUpdateDisposableMap: Map<string, IDisposable> = new Map();
    protected didUpdateEventEmitter = new EventEmitter<IDidUpdateModelNodeEvent>();

    constructor(
        readonly componentId: string,
        id: string,
        text: string,
        readonly attributes: TAttributes,
        children: IModelNode<any>[],
    ) {
        super(id);
        this.internalText = text;
        this.internalChildren = new NodeList(children);
        children.forEach((child) =>
            this.childDidUpdateDisposableMap.set(child.id, child.onDidUpdate(this.handleChildDidUpdate)),
        );
        this.onDidUpdate(() => {
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
            } else {
                this.internalSize = this.children.reduce((size, child) => size + child.size, 2);
            }
        }
        return this.internalSize;
    }

    get needRender() {
        return this.internalNeedRender;
    }

    clearNeedRender() {
        this.internalNeedRender = false;
    }

    replace(from: number, to: number, slice: ISlice) {
        if (from < 1 || from > this.size - 1 || to < 1 || to > this.size - 1) {
            throw new Error('Range is invalid.');
        }
        if (typeof slice.content === 'string') {
            this.internalText = this.internalText.slice(0, from) + slice.content + this.internalText.slice(to);
        } else {
            // TODO
            const childNodes = this.children.map((node) => node);
            const sliceNodes = slice.content.map((node) => node);
            this.internalChildren = new NodeList([
                ...childNodes.slice(0, from),
                ...sliceNodes,
                ...childNodes.slice(to),
            ]);
            const replacedChildNodes = childNodes.slice(from, to);
            replacedChildNodes.forEach((node) => this.childDidUpdateDisposableMap.get(node.id)?.dispose());
            sliceNodes.forEach((node) =>
                this.childDidUpdateDisposableMap.set(node.id, node.onDidUpdate(this.handleChildDidUpdate)),
            );
        }
        this.didUpdateEventEmitter.emit({});
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

    onDidUpdate(listener: IEventListener<IDidUpdateModelNodeEvent>) {
        return this.didUpdateEventEmitter.on(listener);
    }

    protected handleChildDidUpdate = () => {};
}

export class ModelPosition extends Position<IModelNode<any>> implements IModelPosition {}
