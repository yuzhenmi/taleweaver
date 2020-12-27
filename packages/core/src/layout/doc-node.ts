import { IDisposable } from '../event/emitter';
import { BaseLayoutNode, IBaseLayoutNode, ILayoutPositionLayerDescription, IResolveBoundingBoxesResult } from './node';
import { IPageLayoutNode } from './page-node';
import { describePositionForNodeWithChildren } from './utils';

export interface IDocLayoutProps {}

export interface IDocLayout {}

export type IDocLayoutNodeChild = IPageLayoutNode;

export interface IDocLayoutNode extends IBaseLayoutNode<IDocLayoutProps, IDocLayout> {
    readonly type: 'doc';
    readonly renderId: string;
    readonly children: IDocLayoutNodeChild[];
    readonly firstChild: IDocLayoutNodeChild | null;
    readonly lastChild: IDocLayoutNodeChild | null;
    readonly needReflow: boolean;

    setChildren(children: IDocLayoutNodeChild[]): void;
    markAsReflowed(): void;
}

export class DocLayoutNode extends BaseLayoutNode<IDocLayoutProps, IDocLayout> implements IDocLayoutNode {
    readonly type = 'doc';

    protected internalChildren: IDocLayoutNodeChild[] = [];
    protected internalFirstChild: IDocLayoutNodeChild | null = null;
    protected internalLastChild: IDocLayoutNodeChild | null = null;
    protected internalSize?: number;
    protected internalNeedReflow = true;
    protected childDidUpdateDisposableMap: Map<string, IDisposable> = new Map();

    constructor(readonly renderId: string) {
        super();
        this.onDidUpdate(() => {
            this.internalSize = undefined;
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

    setChildren(children: IDocLayoutNodeChild[]) {
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
            child.setPreviousSibling(n > 0 ? children[n - 1] : null);
            child.setNextSibling(n < nn - 1 ? children[n + 1] : null);
        }
        this.didUpdateEventEmitter.emit({});
    }

    markAsReflowed() {
        this.internalNeedReflow = false;
    }

    resolveBoundingBoxes(from: number, to: number): IResolveBoundingBoxesResult {
        if (from < 0 || to > this.size || from > to) {
            throw new Error('Invalid range.');
        }
        const result: IResolveBoundingBoxesResult = {
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

    describePosition(position: number): ILayoutPositionLayerDescription[] {
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
