import { EventEmitter, IDisposable } from '../event/emitter';
import { IEventListener, IOnEvent } from '../event/listener';
import { INode, Node } from '../tree/node';
import { NodeList } from '../tree/node-list';
import { IModelPosition, IResolvedModelPosition } from './position';

export interface IDidUpdateModelNodeEvent {}

export interface IModelNode<TAttributes extends {}> extends INode<IModelNode<TAttributes>> {
    readonly componentId: string;
    readonly partId: string | null;
    readonly attributes: TAttributes;
    readonly text: string;
    readonly needRender: boolean;

    canJoin(node: IModelNode<any>): boolean;
    clearNeedRender(): void;
    applyAttribute(key: string, value: any): any;
    replace(from: number, to: number, content: IModelNode<any>[] | string): IModelNode<any>[] | string;
    resolvePosition(position: IModelPosition): IResolvedModelPosition;
    onDidUpdate: IOnEvent<IDidUpdateModelNodeEvent>;
}

export abstract class ModelNode<TAttributes extends {}> extends Node<IModelNode<TAttributes>>
    implements IModelNode<TAttributes> {
    abstract get partId(): string | null;

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
        children.forEach((child) => {
            child.parent = this;
            this.childDidUpdateDisposableMap.set(child.id, child.onDidUpdate(this.handleChildDidUpdate));
        });
        this.onDidUpdate(() => {
            this.internalSize = undefined;
            this.internalNeedRender = true;
        });
    }

    get text() {
        return this.internalText;
    }

    get contentLength() {
        if (this.leaf) {
            return this.text.length;
        }
        return this.children.length;
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

    applyAttribute(key: string, value: any) {
        // @ts-ignore
        const originalValue = this.attributes[key];
        // @ts-ignore
        this.attributes[key] = value;
        this.didUpdateEventEmitter.emit({});
        return originalValue;
    }

    replace(from: number, to: number, content: IModelNode<any>[] | string) {
        if (from > to) {
            throw new Error('Range is invalid.');
        }
        if (this.leaf) {
            if (typeof content !== 'string') {
                throw new Error('Leaf node content must be string.');
            }
            if (from < 0 || to > this.text.length) {
                throw new Error('Range is invalid.');
            }
        } else {
            if (typeof content === 'string') {
                throw new Error('Non-leaf node content must not be string.');
            }
            if (from < 0 || to > this.children.length) {
                throw new Error('Range is invalid.');
            }
        }
        let replacedContent: IModelNode<any>[] | string;
        if (typeof content === 'string') {
            replacedContent = this.internalText.substring(from, to);
            this.internalText = this.internalText.slice(0, from) + content + this.internalText.slice(to);
        } else {
            replacedContent = this.children.slice(from, to);
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
        return replacedContent;
    }

    resolvePosition(position: IModelPosition): IResolvedModelPosition {
        if (position.length === 0) {
            position = [0];
        }
        const offset = this.boundOffset(position[0]);
        const resolvedPosition: IResolvedModelPosition = [{ node: this, offset }];
        if (!this.leaf) {
            if (offset < this.children.length) {
                const child = this.children.at(offset);
                resolvedPosition.push(...child.resolvePosition(position.slice(1)));
            } else {
                const child = this.children.at(this.children.length - 1);
                resolvedPosition.push(...child.resolvePosition([child.contentLength]));
            }
        }
        return resolvedPosition;
    }

    onDidUpdate(listener: IEventListener<IDidUpdateModelNodeEvent>) {
        return this.didUpdateEventEmitter.on(listener);
    }

    protected handleChildDidUpdate = () => {
        this.didUpdateEventEmitter.emit({});
    };
}
