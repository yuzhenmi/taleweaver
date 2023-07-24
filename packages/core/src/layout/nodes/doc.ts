import { Disposable } from '../../event/emitter';
import { connectSiblings, describePositionForNodeWithChildren } from '../utils';
import { BaseLayoutNode, LayoutPositionLayerDescription, ResolveBoundingBoxesResult } from './base';
import { PageLayoutNode } from './page';

export interface DocLayoutProps {}

export interface DocLayout {}

export type DocLayoutChildNode = PageLayoutNode;

export class DocLayoutNode extends BaseLayoutNode<DocLayoutProps, DocLayout> {
    readonly type = 'doc';

    protected internalChildren: DocLayoutChildNode[] = [];
    protected internalFirstChild: DocLayoutChildNode | null = null;
    protected internalLastChild: DocLayoutChildNode | null = null;
    protected internalSize?: number;
    protected internalNeedReflow = true;
    protected childDidUpdateDisposableMap: Map<string, Disposable> = new Map();

    constructor(readonly renderId: string) {
        super();
        this.onDidUpdate(() => {
            this.internalSize = undefined;
            this.internalNeedReflow = true;
        });
    }

    get children() {
        return this.internalChildren.slice();
    }

    get firstChild() {
        return this.internalFirstChild;
    }

    get lastChild() {
        return this.internalLastChild;
    }

    get size() {
        if (this.internalSize === undefined) {
            this.internalSize = this.calculateSize();
        }
        return this.internalSize;
    }

    get needReflow() {
        return this.internalNeedReflow;
    }

    setChildren(children: DocLayoutChildNode[]) {
        this.childDidUpdateDisposableMap.forEach((disposable) => disposable.dispose());
        this.childDidUpdateDisposableMap.clear();
        children.forEach((child) =>
            this.childDidUpdateDisposableMap.set(child.id, child.onDidUpdate(this.handleChildDidUpdate)),
        );
        this.internalChildren = children;
        if (children.length > 0) {
            this.internalFirstChild = children[0];
            this.internalLastChild = children[children.length - 1];
        } else {
            this.internalFirstChild = null;
            this.internalLastChild = null;
        }
        for (let n = 0, nn = children.length; n < nn; n++) {
            const child = children[n];
            if (n > 0) {
                const previousSibling = children[n - 1];
                connectSiblings(previousSibling, child);
            } else {
                connectSiblings(null, child);
            }
            if (n < nn - 1) {
                const nextSibling = children[n + 1];
                connectSiblings(child, nextSibling);
            } else {
                connectSiblings(child, null);
            }
        }
        this.didUpdateEventEmitter.emit({});
    }

    markAsReflowed() {
        this.internalNeedReflow = false;
    }

    resolveBoundingBoxes(from: number, to: number): ResolveBoundingBoxesResult {
        if (from < 0 || to > this.size || from > to) {
            throw new Error('Invalid range.');
        }
        const result: ResolveBoundingBoxesResult = {
            node: this,
            boundingBoxes: [],
            children: [],
        };
        let cumulatedOffset = 0;
        for (const child of this.internalChildren) {
            if (cumulatedOffset + child.size > from && cumulatedOffset <= to) {
                const childFrom = Math.max(0, from - cumulatedOffset);
                const childTo = Math.min(child.size, to - cumulatedOffset);
                const resolvedChild = child.resolveBoundingBoxes(childFrom, childTo);
                result.children.push(resolvedChild);
            }
            cumulatedOffset += child.size;
        }
        return result;
    }

    describePosition(position: number): LayoutPositionLayerDescription[] {
        return describePositionForNodeWithChildren(this, position);
    }

    protected buildLayout() {
        return {};
    }

    protected calculateSize() {
        return this.internalChildren.reduce((size, child) => size + child.size, 0);
    }

    protected handleChildDidUpdate = () => {
        this.didUpdateEventEmitter.emit({});
    };
}
