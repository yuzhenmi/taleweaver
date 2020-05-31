import { EventEmitter, IDisposable } from '../event/emitter';
import { IEventListener, IOnEvent } from '../event/listener';
import { INode, Node } from '../tree/node';
import { NodeList } from '../tree/node-list';
import { IPosition, IPositionDepth, Position } from '../tree/position';

export interface IDidUpdateModelNodeEvent {}

export interface IModelNode<TAttributes extends {}> extends INode<IModelNode<TAttributes>> {
    readonly componentId: string;
    readonly partId: string | null;
    readonly attributes: TAttributes;
    readonly text: string;
    readonly size: number;
    readonly needRender: boolean;

    canJoin(node: IModelNode<any>): boolean;
    clearNeedRender(): void;
    replace(from: number, to: number, content: IModelNode<any>[] | string): void;
    resolvePosition(offset: number): IModelPosition;
    toDOM(from: number, to: number): HTMLElement;
    onDidUpdate: IOnEvent<IDidUpdateModelNodeEvent>;
}

export interface IModelPosition extends IPosition<IModelNode<any>> {}
export interface IModelPositionDepth extends IPositionDepth<IModelNode<any>> {}

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

    canJoin(node: IModelNode<any>) {
        return false;
    }

    clearNeedRender() {
        this.internalNeedRender = false;
    }

    replace(from: number, to: number, content: IModelNode<any>[] | string) {
        if (from < 1 || from > this.size - 1 || to < 1 || to > this.size - 1) {
            throw new Error('Range is invalid.');
        }
        if (this.leaf) {
            if (typeof content !== 'string') {
                throw new Error('Leaf node content must be string.');
            }
            if (from < 0 || to >= this.text.length) {
                throw new Error('Range is invalid.');
            }
        } else {
            if (typeof content === 'string') {
                throw new Error('Non-leaf node content must not be string.');
            }
            if (from < 0 || to >= this.children.length) {
                throw new Error('Range is invalid.');
            }
        }
        if (typeof content === 'string') {
            this.internalText = this.internalText.slice(0, from) + content + this.internalText.slice(to);
        } else {
            this.internalChildren = new NodeList([
                ...this.children.slice(0, from),
                ...content,
                ...this.children.slice(to),
            ]);
            const removedNodes = this.children.slice(from, to);
            removedNodes.forEach((node) => this.childDidUpdateDisposableMap.get(node.id)?.dispose());
            content.forEach((node) => {
                node.parent = this;
                this.childDidUpdateDisposableMap.set(node.id, node.onDidUpdate(this.handleChildDidUpdate));
            });
        }
        this.didUpdateEventEmitter.emit({});
    }

    resolvePosition(offset: number): IModelPosition {
        if (offset < 0 || offset >= this.size) {
            throw new Error(`Offset ${offset} is out of range.`);
        }
        if (this.leaf) {
            return new ModelPosition([{ node: this, offset }]);
        }
        let cumulatedOffset = 1;
        for (let n = 0, nn = this.children.length; n < nn; n++) {
            const child = this.children.at(n);
            const childSize = child.size;
            if (cumulatedOffset + childSize > offset) {
                const childPosition = child.resolvePosition(offset - cumulatedOffset);
                const depths: IModelPositionDepth[] = [{ node: this, offset }];
                for (let m = 0; m < childPosition.depth; m++) {
                    depths.push(childPosition.atDepth(m));
                }
                return new ModelPosition(depths);
            }
            cumulatedOffset += childSize;
        }
        throw new Error('Offset cannot be resolved.');
    }

    onDidUpdate(listener: IEventListener<IDidUpdateModelNodeEvent>) {
        return this.didUpdateEventEmitter.on(listener);
    }

    protected handleChildDidUpdate = () => {
        this.didUpdateEventEmitter.emit({});
    };
}

export class ModelPosition extends Position<IModelNode<any>> implements IModelPosition {}
