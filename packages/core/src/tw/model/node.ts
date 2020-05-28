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
        } else {
            if (typeof content === 'string') {
                throw new Error('Non-leaf node content must not be string.');
            }
        }
        if (typeof content === 'string') {
            this.internalText = this.internalText.slice(0, from) + content + this.internalText.slice(to);
        } else {
            // Remove replaced nodes
            const fromPosition = this.resolvePosition(from);
            const toPosition = this.resolvePosition(to);
            const fromChild = fromPosition.atDepth(1).node;
            const toChild = toPosition.atDepth(1).node;
            const fromChildOffset = this.children.indexOf(fromChild);
            const toChildOffset = this.children.indexOf(toChild);
            if (fromChild === toChild) {
                // Range is in same child, we just need to remove
                // the range in the child
                cutNode(fromChild, fromPosition.atDepth(1).offset, toPosition.atDepth(1).offset);
            } else {
                // Cut off ends
                cutNode(fromChild, fromPosition.atDepth(1).offset, fromChild.size - 1);
                cutNode(toChild, 1, toPosition.atDepth(1).offset);
                // Remove full nodes
                const removeFrom = fromChildOffset + 1;
                const removeTo = toChildOffset;
                const childNodes = this.children.map((node) => node);
                this.internalChildren = new NodeList([
                    ...childNodes.slice(0, removeFrom),
                    ...childNodes.slice(removeTo),
                ]);
                const removedNodes = childNodes.slice(removeFrom, removeTo);
                removedNodes.forEach((node) => this.childDidUpdateDisposableMap.get(node.id)?.dispose());
            }
            // Insert new nodes
            const childNodes = this.children.map((node) => node);
            const insertAt = fromChildOffset + 1;
            this.internalChildren = new NodeList([
                ...childNodes.slice(0, insertAt),
                ...content,
                ...childNodes.slice(insertAt),
            ]);
            content.forEach((node) =>
                this.childDidUpdateDisposableMap.set(node.id, node.onDidUpdate(this.handleChildDidUpdate)),
            );
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

function cutNode(node: IModelNode<any>, from: number, to: number) {
    if (node.leaf) {
        node.replace(from, to, '');
    } else {
        node.replace(from, to, []);
    }
}
