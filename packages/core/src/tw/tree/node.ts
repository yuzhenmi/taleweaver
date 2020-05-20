import { EventEmitter, IDisposable } from '../event/emitter';
import { IEventListener, IOnEvent } from '../event/listener';
import { INodeList, NodeList } from './node-list';

export interface IDidSetChildrenEvent {}

export interface IDidUpdateNodeEvent {}

export interface INode<TNode extends INode<TNode>> {
    readonly id: string;

    readonly root: boolean;
    readonly leaf: boolean;

    parent: TNode | null;

    readonly children: INodeList<TNode>;
    readonly firstChild: TNode | null;
    readonly lastChild: TNode | null;

    readonly previousSibling: TNode | null;
    readonly nextSibling: TNode | null;
    readonly previousCrossParentSibling: TNode | null;
    readonly nextCrossParentSibling: TNode | null;

    childAt(index: number): TNode;
    setChildren(nodes: TNode[]): void;
    findDescendant(descendantId: string): TNode | null;

    onDidSetChildren: IOnEvent<IDidSetChildrenEvent>;
    onDidUpdateNode: IOnEvent<IDidUpdateNodeEvent>;
}

export abstract class Node<TNode extends INode<TNode>> implements INode<TNode> {
    abstract get root(): boolean;
    abstract get leaf(): boolean;

    parent: TNode | null = null;

    protected internalChildren = new NodeList<TNode>();
    protected didSetChildrenEventEmitter = new EventEmitter<IDidSetChildrenEvent>();
    protected didUpdateNodeEventEmitter = new EventEmitter<IDidUpdateNodeEvent>();
    protected childrenDidUpdateEventListenerDisposable: IDisposable;

    constructor(readonly id: string) {
        this.childrenDidUpdateEventListenerDisposable = this.children.onDidUpdateNodeList(() =>
            this.didUpdateNodeEventEmitter.emit({}),
        );
    }

    get children() {
        return this.internalChildren;
    }

    get firstChild() {
        if (this.children.length === 0) {
            return null;
        }
        return this.children.at(0);
    }

    get lastChild() {
        if (this.children.length === 0) {
            return null;
        }
        return this.children.at(this.children.length - 1);
    }

    get previousSibling() {
        if (!this.parent) {
            return null;
        }
        const siblings = this.parent.children;
        const ownIndex = siblings.indexOf(this as any);
        if (ownIndex < 0) {
            throw new Error('Node is not a child of parent.');
        }
        if (ownIndex === 0) {
            return null;
        }
        return siblings.at(ownIndex - 1);
    }

    get nextSibling() {
        if (!this.parent) {
            return null;
        }
        const siblings = this.parent.children;
        const ownIndex = siblings.indexOf(this as any);
        if (ownIndex < 0) {
            throw new Error('Node is not a child of parent.');
        }
        if (ownIndex === siblings.length - 1) {
            return null;
        }
        return siblings.at(ownIndex + 1);
    }

    get previousCrossParentSibling() {
        const previousSibling = this.previousSibling;
        if (previousSibling) {
            return previousSibling;
        }
        const parent = this.parent;
        if (!parent || parent.root) {
            return null;
        }
        const parentPreviousSibling = parent.previousCrossParentSibling;
        if (!parentPreviousSibling) {
            return null;
        }
        return parentPreviousSibling.lastChild;
    }

    get nextCrossParentSibling() {
        const nextSibling = this.nextSibling;
        if (nextSibling) {
            return nextSibling;
        }
        const parent = this.parent;
        if (!parent || parent.root) {
            return null;
        }
        const parentNextSibling = parent.nextCrossParentSibling;
        if (!parentNextSibling) {
            return null;
        }
        return parentNextSibling.firstChild;
    }

    childAt(index: number) {
        return this.children.at(index);
    }

    setChildren(nodes: TNode[]) {
        this.internalChildren = new NodeList(nodes);
        nodes.forEach((node) => (node.parent = this as any));
        this.didSetChildrenEventEmitter.emit({});
        this.didUpdateNodeEventEmitter.emit({});
    }

    findDescendant(id: string): TNode | null {
        if (this.id === id) {
            return this as any;
        }
        if (this.leaf) {
            return null;
        }
        for (let n = 0, nn = this.children.length; n < nn; n++) {
            const child = this.children.at(n);
            const result = child.findDescendant(id);
            if (result) {
                return result;
            }
        }
        return null;
    }

    onDidSetChildren(listener: IEventListener<IDidSetChildrenEvent>) {
        return this.didSetChildrenEventEmitter.on(listener);
    }

    onDidUpdateNode(listener: IEventListener<IDidUpdateNodeEvent>) {
        return this.didUpdateNodeEventEmitter.on(listener);
    }
}
