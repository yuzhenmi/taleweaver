import { EventEmitter, IDisposable } from '../event/emitter';
import { IEventListener, IOnEvent } from '../event/listener';
import { ITextService, ITextStyle } from '../text/service';
import { generateId } from '../util/id';

export interface IDidUpdateLayoutNodeEvent {}

export interface IBoundingBox {
    from: number;
    to: number;
    width: number;
    height: number;
    left: number;
    right: number;
    top: number;
    bottom: number;
}

export interface IResolveBoundingBoxesResult {
    node: ILayoutNode;
    boundingBoxes: IBoundingBox[];
    children: IResolveBoundingBoxesResult[];
}

export interface ILayoutPositionLayerDescription<TNode extends ILayoutNode = any> {
    node: TNode;
    position: number;
}

interface IBaseLayoutNode<TStyle> {
    readonly id: string;
    readonly style: TStyle;
    readonly size: number;
    readonly needDisplay: boolean;

    setStyle(style: TStyle): void;
    markAsDisplayed(): void;
    resolveBoundingBoxes(from: number, to: number): IResolveBoundingBoxesResult;
    describePosition(position: number): ILayoutPositionLayerDescription[];
    onDidUpdate: IOnEvent<IDidUpdateLayoutNodeEvent>;
}

export interface IDocStyle {}

export type IDocLayoutNodeChild = IPageLayoutNode;

export interface IDocLayoutNode extends IBaseLayoutNode<IDocStyle> {
    readonly type: 'doc';
    readonly renderId: string;
    readonly children: IDocLayoutNodeChild[];
    readonly firstChild: IDocLayoutNodeChild | null;
    readonly lastChild: IDocLayoutNodeChild | null;
    readonly needReflow: boolean;

    setChildren(children: IDocLayoutNodeChild[]): void;
    markAsReflowed(): void;
}

export interface IPageStyle {
    width: number;
    height: number;
    paddingTop: number;
    paddingBottom: number;
    paddingLeft: number;
    paddingRight: number;
}

export type IPageLayoutNodeChild = IBlockLayoutNode;
export type IPageLayoutNodeSibling = IPageLayoutNode;

export interface IPageLayoutNode extends IBaseLayoutNode<IPageStyle> {
    readonly type: 'page';
    readonly children: IPageLayoutNodeChild[];
    readonly firstChild: IPageLayoutNodeChild | null;
    readonly lastChild: IPageLayoutNodeChild | null;
    readonly previousSibling: IPageLayoutNodeSibling | null;
    readonly nextSibling: IPageLayoutNodeSibling | null;
    readonly needReflow: boolean;
    readonly width: number;
    readonly height: number;
    readonly paddingTop: number;
    readonly paddingBottom: number;
    readonly paddingLeft: number;
    readonly paddingRight: number;
    readonly contentWidth: number;
    readonly contentHeight: number;

    setChildren(children: IPageLayoutNodeChild[]): void;
    setPreviousSibling(previousSibling: IPageLayoutNodeSibling | null): void;
    setNextSibling(previousSibling: IPageLayoutNodeSibling | null): void;
    markAsReflowed(): void;
    convertCoordinatesToPosition(x: number, y: number): number;
}

export interface IBlockStyle {
    width: number;
    paddingTop: number;
    paddingBottom: number;
    paddingLeft: number;
    paddingRight: number;
}

export type IBlockLayoutNodeChild = ILineLayoutNode;
export type IBlockLayoutNodeSibling = IBlockLayoutNode;

export interface IBlockLayoutNode extends IBaseLayoutNode<IBlockStyle> {
    readonly type: 'block';
    readonly renderId: string;
    readonly children: IBlockLayoutNodeChild[];
    readonly firstChild: IBlockLayoutNodeChild | null;
    readonly lastChild: IBlockLayoutNodeChild | null;
    readonly previousSibling: IBlockLayoutNodeSibling | null;
    readonly nextSibling: IBlockLayoutNodeSibling | null;
    readonly previousCrossParentSibling: IBlockLayoutNodeSibling | null;
    readonly nextCrossParentSibling: IBlockLayoutNodeSibling | null;
    readonly needReflow: boolean;
    readonly width: number;
    readonly height: number;
    readonly paddingTop: number;
    readonly paddingBottom: number;
    readonly paddingLeft: number;
    readonly paddingRight: number;
    readonly contentWidth: number;
    readonly contentHeight: number;

    setChildren(children: IBlockLayoutNodeChild[]): void;
    setPreviousSibling(previousSibling: IBlockLayoutNodeSibling | null): void;
    setNextSibling(previousSibling: IBlockLayoutNodeSibling | null): void;
    setPreviousCrossParentSibling(previousCrossParentSibling: IBlockLayoutNodeSibling | null): void;
    setNextCrossParentSibling(previousCrossParentSibling: IBlockLayoutNodeSibling | null): void;
    markAsReflowed(): void;
    convertCoordinatesToPosition(x: number, y: number): number;
}

export interface ILineStyle {
    width: number;
    lineHeight: number;
}

export type ILineLayoutNodeChild = ITextLayoutNode | IInlineLayoutNode;
export type ILineLayoutNodeSibling = ILineLayoutNode;

export interface ILineLayoutNode extends IBaseLayoutNode<ILineStyle> {
    readonly type: 'line';
    readonly children: ILineLayoutNodeChild[];
    readonly firstChild: ILineLayoutNodeChild | null;
    readonly lastChild: ILineLayoutNodeChild | null;
    readonly previousSibling: ILineLayoutNodeSibling | null;
    readonly nextSibling: ILineLayoutNodeSibling | null;
    readonly previousCrossParentSibling: ILineLayoutNodeSibling | null;
    readonly nextCrossParentSibling: ILineLayoutNodeSibling | null;
    readonly width: number;
    readonly height: number;
    readonly contentHeight: number;
    readonly trimmedWidth: number;
    readonly needReflow: boolean;

    setChildren(children: ILineLayoutNodeChild[]): void;
    setPreviousSibling(previousSibling: ILineLayoutNodeSibling | null): void;
    setNextSibling(previousSibling: ILineLayoutNodeSibling | null): void;
    setPreviousCrossParentSibling(previousCrossParentSibling: ILineLayoutNodeSibling | null): void;
    setNextCrossParentSibling(previousCrossParentSibling: ILineLayoutNodeSibling | null): void;
    markAsReflowed(): void;
    convertCoordinatesToPosition(x: number, y: number): number;
}

export type ITextLayoutNodeChild = IWordLayoutNode;
export type ITextLayoutNodeSibling = ITextLayoutNode | IInlineLayoutNode;

export interface ITextLayoutNode extends IBaseLayoutNode<ITextStyle> {
    readonly type: 'text';
    readonly renderId: string;
    readonly children: ITextLayoutNodeChild[];
    readonly firstChild: ITextLayoutNodeChild | null;
    readonly lastChild: ITextLayoutNodeChild | null;
    readonly previousSibling: ITextLayoutNodeSibling | null;
    readonly nextSibling: ITextLayoutNodeSibling | null;
    readonly previousCrossParentSibling: ITextLayoutNodeSibling | null;
    readonly nextCrossParentSibling: ITextLayoutNodeSibling | null;
    readonly width: number;
    readonly height: number;
    readonly trimmedWidth: number;

    setChildren(children: ITextLayoutNodeChild[]): void;
    setPreviousSibling(previousSibling: ITextLayoutNodeSibling | null): void;
    setNextSibling(previousSibling: ITextLayoutNodeSibling | null): void;
    setPreviousCrossParentSibling(previousCrossParentSibling: ITextLayoutNodeSibling | null): void;
    setNextCrossParentSibling(previousCrossParentSibling: ITextLayoutNodeSibling | null): void;
    convertCoordinatesToPosition(x: number, y: number): number;
}

export type IWordLayoutNodeSibling = IWordLayoutNode | IInlineLayoutNode;

export interface IWordLayoutNode extends IBaseLayoutNode<ITextStyle> {
    readonly type: 'word';
    readonly previousSibling: IWordLayoutNodeSibling | null;
    readonly nextSibling: IWordLayoutNodeSibling | null;
    readonly previousCrossParentSibling: IWordLayoutNodeSibling | null;
    readonly nextCrossParentSibling: IWordLayoutNodeSibling | null;
    readonly content: string;
    readonly whitespaceSize: number;
    readonly trimmedSize: number;
    readonly width: number;
    readonly height: number;
    readonly trimmedWidth: number;

    setPreviousSibling(previousSibling: IWordLayoutNodeSibling | null): void;
    setNextSibling(previousSibling: IWordLayoutNodeSibling | null): void;
    setPreviousCrossParentSibling(previousCrossParentSibling: IWordLayoutNodeSibling | null): void;
    setNextCrossParentSibling(previousCrossParentSibling: IWordLayoutNodeSibling | null): void;
    setContent(content: string): void;
    setWhitespaceSize(whitespaceSize: number): void;
    convertCoordinatesToPosition(x: number, y: number): number;
}

export interface IInlineStyle {
    width: number;
    height: number;
}

export type IInlineLayoutNodeSibling = IInlineLayoutNode | ITextLayoutNode;
export type IInlineLayoutNodeContentSibling = IInlineLayoutNode | IWordLayoutNode;

export interface IInlineLayoutNode extends IBaseLayoutNode<IInlineStyle> {
    readonly type: 'inline';
    readonly renderId: string;
    readonly previousSibling: IInlineLayoutNodeSibling | null;
    readonly nextSibling: IInlineLayoutNodeSibling | null;
    readonly previousCrossParentSibling: IInlineLayoutNodeSibling | null;
    readonly nextCrossParentSibling: IInlineLayoutNodeSibling | null;
    readonly previousContentSibling: IInlineLayoutNodeContentSibling | null;
    readonly nextContentSibling: IInlineLayoutNodeContentSibling | null;
    readonly previousCrossParentContentSibling: IInlineLayoutNodeContentSibling | null;
    readonly nextCrossParentContentSibling: IInlineLayoutNodeContentSibling | null;
    readonly trimmedSize: 1;
    readonly width: number;
    readonly height: number;

    setPreviousSibling(previousSibling: IInlineLayoutNodeSibling | null): void;
    setNextSibling(previousSibling: IInlineLayoutNodeSibling | null): void;
    setPreviousCrossParentSibling(previousCrossParentSibling: IInlineLayoutNodeSibling | null): void;
    setNextCrossParentSibling(previousCrossParentSibling: IInlineLayoutNodeSibling | null): void;
    setPreviousContentSibling(previousSibling: IInlineLayoutNodeContentSibling | null): void;
    setNextContentSibling(previousSibling: IInlineLayoutNodeContentSibling | null): void;
    setPreviousCrossParentContentSibling(previousCrossParentSibling: IInlineLayoutNodeContentSibling | null): void;
    setNextCrossParentContentSibling(previousCrossParentSibling: IInlineLayoutNodeContentSibling | null): void;
    convertCoordinatesToPosition(x: number, y: number): number;
}

export type ILayoutNode =
    | IDocLayoutNode
    | IPageLayoutNode
    | IBlockLayoutNode
    | ILineLayoutNode
    | IInlineLayoutNode
    | ITextLayoutNode
    | IWordLayoutNode;

export type IBoundedLayoutNode = IPageLayoutNode | ILineLayoutNode;

abstract class BaseLayoutNode<TStyle> implements IBaseLayoutNode<TStyle> {
    abstract readonly size: number;

    abstract resolveBoundingBoxes(from: number, to: number): IResolveBoundingBoxesResult;

    abstract describePosition(position: number): ILayoutPositionLayerDescription[];

    readonly id = generateId();

    protected internalStyle?: TStyle;
    protected internalNeedDisplay = true;
    protected didUpdateEventEmitter = new EventEmitter<IDidUpdateLayoutNodeEvent>();

    constructor() {
        this.onDidUpdate(() => {
            this.internalNeedDisplay = true;
        });
    }

    get style(): TStyle {
        if (!this.internalStyle) {
            throw new Error('Style is not initialized.');
        }
        return JSON.parse(JSON.stringify(this.internalStyle));
    }

    get needDisplay() {
        return this.internalNeedDisplay;
    }

    setStyle(style: TStyle) {
        this.internalStyle = style;
    }

    markAsDisplayed() {
        this.internalNeedDisplay = false;
    }

    onDidUpdate(listener: IEventListener<IDidUpdateLayoutNodeEvent>) {
        return this.didUpdateEventEmitter.on(listener);
    }
}

export class DocLayoutNode extends BaseLayoutNode<IDocStyle> implements IDocLayoutNode {
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

    protected calculateSize() {
        return this.internalChildren.reduce((size, child) => size + child.size, 0);
    }

    protected handleChildDidUpdate = () => {
        this.didUpdateEventEmitter.emit({});
    };
}

export class PageLayoutNode extends BaseLayoutNode<IPageStyle> implements IPageLayoutNode {
    readonly type = 'page';

    protected internalChildren: IPageLayoutNodeChild[] = [];
    protected internalFirstChild: IPageLayoutNodeChild | null = null;
    protected internalLastChild: IPageLayoutNodeChild | null = null;
    protected internalPreviousSibling: IPageLayoutNodeSibling | null = null;
    protected internalNextSibling: IPageLayoutNodeSibling | null = null;
    protected internalPreviousCrossParentSibling: IPageLayoutNodeSibling | null = null;
    protected internalNextCrossParentSibling: IPageLayoutNodeSibling | null = null;
    protected internalSize?: number;
    protected internalNeedReflow = true;
    protected childDidUpdateDisposableMap: Map<string, IDisposable> = new Map();

    constructor() {
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

    get previousSibling() {
        return this.internalPreviousSibling;
    }

    get nextSibling() {
        return this.internalNextSibling;
    }

    get previousCrossParentSibling() {
        return this.internalPreviousCrossParentSibling;
    }

    get nextCrossParentSibling() {
        return this.internalNextCrossParentSibling;
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

    get width() {
        if (!this.internalStyle) {
            return 0;
        }
        return this.internalStyle.width;
    }

    get height() {
        if (!this.internalStyle) {
            return 0;
        }
        return this.internalStyle.height;
    }

    get paddingTop() {
        if (!this.internalStyle) {
            return 0;
        }
        return this.internalStyle.paddingTop;
    }

    get paddingBottom() {
        if (!this.internalStyle) {
            return 0;
        }
        return this.internalStyle.paddingBottom;
    }

    get paddingLeft() {
        if (!this.internalStyle) {
            return 0;
        }
        return this.internalStyle.paddingLeft;
    }

    get paddingRight() {
        if (!this.internalStyle) {
            return 0;
        }
        return this.internalStyle.paddingRight;
    }

    get contentWidth() {
        return this.width - this.paddingLeft - this.paddingRight;
    }

    get contentHeight() {
        return this.height - this.paddingTop - this.paddingBottom;
    }

    setChildren(children: IPageLayoutNodeChild[]) {
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
                child.setPreviousSibling(previousSibling);
                child.setPreviousCrossParentSibling(previousSibling);
            } else {
                child.setPreviousSibling(null);
                child.previousCrossParentSibling?.setNextCrossParentSibling(null);
                const previousCrossParentSibling = this.internalPreviousCrossParentSibling?.lastChild ?? null;
                child.setPreviousCrossParentSibling(previousCrossParentSibling);
                previousCrossParentSibling?.setNextCrossParentSibling(child);
            }
            if (n < nn - 1) {
                const nextSibling = children[n + 1];
                child.setNextSibling(nextSibling);
                child.setNextCrossParentSibling(nextSibling);
            } else {
                child.setNextSibling(null);
                child.nextCrossParentSibling?.setPreviousCrossParentSibling(null);
                const nextCrossParentSibling = this.internalNextCrossParentSibling?.firstChild ?? null;
                child.setNextCrossParentSibling(nextCrossParentSibling);
                nextCrossParentSibling?.setPreviousCrossParentSibling(child);
            }
        }
        this.didUpdateEventEmitter.emit({});
    }

    setPreviousSibling(previousSibling: IPageLayoutNodeSibling | null) {
        this.internalPreviousSibling = previousSibling;
    }

    setNextSibling(nextSibling: IPageLayoutNodeSibling | null) {
        this.internalNextSibling = nextSibling;
    }

    setPreviousCrossParentSibling(previousCrossParentSibling: IPageLayoutNodeSibling | null) {
        this.internalPreviousCrossParentSibling = previousCrossParentSibling;
    }

    setNextCrossParentSibling(nextCrossParentSibling: IPageLayoutNodeSibling | null) {
        this.internalNextCrossParentSibling = nextCrossParentSibling;
    }

    markAsReflowed() {
        this.internalNeedReflow = false;
    }

    convertCoordinatesToPosition(x: number, y: number) {
        return convertCoordinatesToPositionForVerticallyFlowingNode(
            x,
            y,
            this.paddingLeft,
            this.paddingTop,
            this.contentWidth,
            this.contentHeight,
            this.internalChildren,
        );
    }

    resolveBoundingBoxes(from: number, to: number) {
        if (from < 0 || to > this.size || from > to) {
            throw new Error('Invalid range.');
        }
        const result: IResolveBoundingBoxesResult = {
            node: this,
            boundingBoxes: [],
            children: [],
        };
        let cumulatedOffset = 0;
        let cumulatedHeight = 0;
        for (const child of this.internalChildren) {
            if (cumulatedOffset + child.size > from && cumulatedOffset <= to) {
                const childFrom = Math.max(0, from - cumulatedOffset);
                const childTo = Math.min(child.size, to - cumulatedOffset);
                const resolvedChild = child.resolveBoundingBoxes(childFrom, childTo);
                result.children.push(resolvedChild);
                for (const boundingBox of resolvedChild.boundingBoxes) {
                    result.boundingBoxes.push({
                        from: cumulatedOffset + childFrom,
                        to: cumulatedOffset + childTo,
                        width: boundingBox.width,
                        height: boundingBox.height,
                        top: cumulatedHeight + this.paddingTop + boundingBox.top,
                        bottom: this.height - this.paddingTop - cumulatedHeight - child.height + boundingBox.bottom,
                        left: boundingBox.left + this.paddingLeft,
                        right: boundingBox.right + this.paddingRight,
                    });
                }
            }
            cumulatedOffset += child.size;
            cumulatedHeight += child.height;
        }
        return result;
    }

    describePosition(position: number): ILayoutPositionLayerDescription[] {
        return describePositionForNodeWithChildren(this, position);
    }

    protected calculateSize() {
        return this.internalChildren.reduce((size, child) => size + child.size, 0);
    }

    protected handleChildDidUpdate = () => {
        this.didUpdateEventEmitter.emit({});
    };
}

export class BlockLayoutNode extends BaseLayoutNode<IBlockStyle> implements IBlockLayoutNode {
    readonly type = 'block';

    protected internalChildren: IBlockLayoutNodeChild[] = [];
    protected internalFirstChild: IBlockLayoutNodeChild | null = null;
    protected internalLastChild: IBlockLayoutNodeChild | null = null;
    protected internalPreviousSibling: IBlockLayoutNodeSibling | null = null;
    protected internalNextSibling: IBlockLayoutNodeSibling | null = null;
    protected internalPreviousCrossParentSibling: IBlockLayoutNodeSibling | null = null;
    protected internalNextCrossParentSibling: IBlockLayoutNodeSibling | null = null;
    protected internalSize?: number;
    protected internalHeight?: number;
    protected internalNeedReflow = true;
    protected childDidUpdateDisposableMap: Map<string, IDisposable> = new Map();

    constructor(readonly renderId: string) {
        super();
        this.onDidUpdate(() => {
            this.internalSize = undefined;
            this.internalHeight = undefined;
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

    get previousSibling() {
        return this.internalPreviousSibling;
    }

    get nextSibling() {
        return this.internalNextSibling;
    }

    get previousCrossParentSibling() {
        return this.internalPreviousCrossParentSibling;
    }

    get nextCrossParentSibling() {
        return this.internalNextCrossParentSibling;
    }

    get size() {
        if (this.internalSize === undefined) {
            this.internalSize = this.calculateSize();
        }
        return this.internalSize;
    }

    get width() {
        if (!this.internalStyle) {
            return 0;
        }
        return this.internalStyle.width;
    }

    get height() {
        if (this.internalHeight === undefined) {
            this.internalHeight = this.calculateHeight();
        }
        return this.internalHeight;
    }

    get paddingTop() {
        if (!this.internalStyle) {
            return 0;
        }
        return this.internalStyle.paddingTop;
    }

    get paddingBottom() {
        if (!this.internalStyle) {
            return 0;
        }
        return this.internalStyle.paddingBottom;
    }

    get paddingLeft() {
        if (!this.internalStyle) {
            return 0;
        }
        return this.internalStyle.paddingLeft;
    }

    get paddingRight() {
        if (!this.internalStyle) {
            return 0;
        }
        return this.internalStyle.paddingRight;
    }

    get contentWidth() {
        return this.width - this.paddingLeft - this.paddingRight;
    }

    get contentHeight() {
        return this.height - this.paddingTop - this.paddingBottom;
    }

    get needReflow() {
        return this.internalNeedReflow;
    }

    setChildren(children: IBlockLayoutNodeChild[]) {
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
                child.setPreviousSibling(previousSibling);
                child.setPreviousCrossParentSibling(previousSibling);
            } else {
                child.setPreviousSibling(null);
                child.previousCrossParentSibling?.setNextCrossParentSibling(null);
                const previousCrossParentSibling = this.internalPreviousCrossParentSibling?.lastChild ?? null;
                child.setPreviousCrossParentSibling(previousCrossParentSibling);
                previousCrossParentSibling?.setNextCrossParentSibling(child);
            }
            if (n < nn - 1) {
                const nextSibling = children[n + 1];
                child.setNextSibling(nextSibling);
                child.setNextCrossParentSibling(nextSibling);
            } else {
                child.setNextSibling(null);
                child.nextCrossParentSibling?.setPreviousCrossParentSibling(null);
                const nextCrossParentSibling = this.internalNextCrossParentSibling?.firstChild ?? null;
                child.setNextCrossParentSibling(nextCrossParentSibling);
                nextCrossParentSibling?.setPreviousCrossParentSibling(child);
            }
        }
        this.didUpdateEventEmitter.emit({});
    }

    setPreviousSibling(previousSibling: IBlockLayoutNodeSibling | null) {
        this.internalPreviousSibling = previousSibling;
    }

    setNextSibling(nextSibling: IBlockLayoutNodeSibling | null) {
        this.internalNextSibling = nextSibling;
    }

    setPreviousCrossParentSibling(previousCrossParentSibling: IBlockLayoutNodeSibling | null) {
        this.internalPreviousCrossParentSibling = previousCrossParentSibling;
    }

    setNextCrossParentSibling(nextCrossParentSibling: IBlockLayoutNodeSibling | null) {
        this.internalNextCrossParentSibling = nextCrossParentSibling;
    }

    markAsReflowed() {
        this.internalNeedReflow = false;
    }

    convertCoordinatesToPosition(x: number, y: number) {
        return convertCoordinatesToPositionForVerticallyFlowingNode(
            x,
            y,
            this.paddingLeft,
            this.paddingTop,
            this.contentWidth,
            this.contentHeight,
            this.internalChildren,
        );
    }

    resolveBoundingBoxes(from: number, to: number) {
        if (from < 0 || to > this.size || from > to) {
            throw new Error('Invalid range.');
        }
        const result: IResolveBoundingBoxesResult = {
            node: this,
            boundingBoxes: [],
            children: [],
        };
        let cumulatedOffset = 0;
        let cumulatedHeight = 0;
        for (const child of this.internalChildren) {
            if (cumulatedOffset + child.size > from && cumulatedOffset <= to) {
                const childFrom = Math.max(0, from - cumulatedOffset);
                const childTo = Math.min(child.size, to - cumulatedOffset);
                const childResult = child.resolveBoundingBoxes(childFrom, childTo);
                result.children.push(childResult);
                for (const boundingBox of childResult.boundingBoxes) {
                    result.boundingBoxes.push({
                        from: cumulatedOffset + childFrom,
                        to: cumulatedOffset + childTo,
                        width: boundingBox.width,
                        height: boundingBox.height,
                        top: cumulatedHeight + this.paddingTop + boundingBox.top,
                        bottom: this.height - this.paddingTop - cumulatedHeight - child.height + boundingBox.bottom,
                        left: boundingBox.left,
                        right: boundingBox.right,
                    });
                }
            }
            cumulatedOffset += child.size;
            cumulatedHeight += child.height;
        }
        return result;
    }

    describePosition(position: number): ILayoutPositionLayerDescription[] {
        return describePositionForNodeWithChildren(this, position);
    }

    protected calculateSize() {
        return this.internalChildren.reduce((size, child) => size + child.size, 0);
    }

    protected calculateHeight() {
        return this.internalChildren.reduce((height, child) => height + child.height, 0);
    }

    protected handleChildDidUpdate = () => {
        this.didUpdateEventEmitter.emit({});
    };
}

export class LineLayoutNode extends BaseLayoutNode<ILineStyle> implements ILineLayoutNode {
    readonly type = 'line';

    protected internalChildren: ILineLayoutNodeChild[] = [];
    protected internalFirstChild: ILineLayoutNodeChild | null = null;
    protected internalLastChild: ILineLayoutNodeChild | null = null;
    protected internalPreviousSibling: ILineLayoutNodeSibling | null = null;
    protected internalNextSibling: ILineLayoutNodeSibling | null = null;
    protected internalPreviousCrossParentSibling: ILineLayoutNodeSibling | null = null;
    protected internalNextCrossParentSibling: ILineLayoutNodeSibling | null = null;
    protected internalSize?: number;
    protected internalContentHeight?: number;
    protected internalTrimmedWidth?: number;
    protected internalNeedReflow = true;
    protected childDidUpdateDisposableMap: Map<string, IDisposable> = new Map();

    constructor() {
        super();
        this.onDidUpdate(() => {
            this.internalSize = undefined;
            this.internalContentHeight = undefined;
            this.internalTrimmedWidth = undefined;
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

    get previousSibling() {
        return this.internalPreviousSibling;
    }

    get nextSibling() {
        return this.internalNextSibling;
    }

    get previousCrossParentSibling() {
        return this.internalPreviousCrossParentSibling;
    }

    get nextCrossParentSibling() {
        return this.internalNextCrossParentSibling;
    }

    get size() {
        if (this.internalSize === undefined) {
            this.internalSize = this.calculateSize();
        }
        return this.internalSize;
    }

    get width() {
        if (!this.internalStyle) {
            return 0;
        }
        return this.internalStyle.width;
    }

    get height() {
        if (!this.internalStyle) {
            return this.contentHeight;
        }
        return this.contentHeight * this.internalStyle.lineHeight;
    }

    get contentHeight() {
        if (this.internalContentHeight === undefined) {
            this.internalContentHeight = this.calculateHeight();
        }
        return this.internalContentHeight;
    }

    get trimmedWidth() {
        if (this.internalTrimmedWidth === undefined) {
            this.internalTrimmedWidth = this.calculateTrimmedWidth();
        }
        return this.internalTrimmedWidth;
    }

    get needReflow() {
        return this.internalNeedReflow;
    }

    setChildren(children: ILineLayoutNodeChild[]) {
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
                child.setPreviousSibling(previousSibling);
                child.setPreviousCrossParentSibling(previousSibling);
            } else {
                child.setPreviousSibling(null);
                child.previousCrossParentSibling?.setNextCrossParentSibling(null);
                const previousCrossParentSibling = this.internalPreviousCrossParentSibling?.lastChild ?? null;
                child.setPreviousCrossParentSibling(previousCrossParentSibling);
                previousCrossParentSibling?.setNextCrossParentSibling(child);
            }
            if (n < nn - 1) {
                const nextSibling = children[n + 1];
                child.setNextSibling(nextSibling);
                child.setNextCrossParentSibling(nextSibling);
            } else {
                child.setNextSibling(null);
                child.nextCrossParentSibling?.setPreviousCrossParentSibling(null);
                const nextCrossParentSibling = this.internalNextCrossParentSibling?.firstChild ?? null;
                child.setNextCrossParentSibling(nextCrossParentSibling);
                nextCrossParentSibling?.setPreviousCrossParentSibling(child);
            }
        }
        this.didUpdateEventEmitter.emit({});
    }

    setPreviousSibling(previousSibling: ILineLayoutNodeSibling | null) {
        this.internalPreviousSibling = previousSibling;
    }

    setNextSibling(nextSibling: ILineLayoutNodeSibling | null) {
        this.internalNextSibling = nextSibling;
    }

    setPreviousCrossParentSibling(previousCrossParentSibling: ILineLayoutNodeSibling | null) {
        this.internalPreviousCrossParentSibling = previousCrossParentSibling;
    }

    setNextCrossParentSibling(nextCrossParentSibling: ILineLayoutNodeSibling | null) {
        this.internalNextCrossParentSibling = nextCrossParentSibling;
    }

    markAsReflowed() {
        this.internalNeedReflow = false;
    }

    convertCoordinatesToPosition(x: number, y: number) {
        return convertCoordinatesToPositionForHorizontallyFlowingNode(
            x,
            y,
            0,
            0,
            this.width,
            this.height,
            this.internalChildren,
        );
    }

    resolveBoundingBoxes(from: number, to: number) {
        if (from < 0 || to > this.size || from > to) {
            throw new Error('Invalid range.');
        }
        const result: IResolveBoundingBoxesResult = {
            node: this,
            boundingBoxes: [],
            children: [],
        };
        let cumulatedOffset = 0;
        let left1: number | null = null;
        let left2 = 0;
        for (const child of this.internalChildren) {
            if (cumulatedOffset > to) {
                break;
            }
            if (cumulatedOffset + child.size > from) {
                const childFrom = Math.max(0, from - cumulatedOffset);
                const childTo = Math.min(child.size, to - cumulatedOffset);
                const resolvedChild = child.resolveBoundingBoxes(childFrom, childTo);
                result.children.push(resolvedChild);
                if (left1 === null) {
                    left1 = left2 + resolvedChild.boundingBoxes[0].left;
                }
                left2 += resolvedChild.boundingBoxes
                    .slice(0, resolvedChild.boundingBoxes.length - 1)
                    .reduce((width, box) => width + box.left + box.width + box.right, 0);
                left2 += resolvedChild.boundingBoxes[0].left + resolvedChild.boundingBoxes[0].width;
            } else {
                left2 += child.width;
            }
            cumulatedOffset += child.size;
        }
        result.boundingBoxes.push({
            from,
            to,
            width: left2! - left1!,
            height: from === to ? this.contentHeight : this.height,
            left: left1!,
            right: this.width - left2!,
            top: 0,
            bottom: 0,
        });
        return result;
    }

    describePosition(position: number): ILayoutPositionLayerDescription[] {
        return describePositionForNodeWithChildren(this, position);
    }

    protected calculateSize() {
        return this.internalChildren.reduce((size, child) => size + child.size, 0);
    }

    protected calculateWidth() {
        return this.internalChildren.reduce((width, child) => width + child.width, 0);
    }

    protected calculateHeight() {
        return this.internalChildren.reduce((height, child) => Math.max(height, child.height), 0);
    }

    protected calculateTrimmedWidth() {
        let trimmedWidth = 0;
        for (let n = 0, nn = this.internalChildren.length - 1; n < nn; n++) {
            trimmedWidth += this.internalChildren[n].width;
        }
        if (this.internalChildren.length > 0) {
            const lastChild = this.internalChildren[this.internalChildren.length - 1];
            if (lastChild.type === 'text') {
                trimmedWidth += lastChild.trimmedWidth;
            }
        }
        return trimmedWidth;
    }

    protected handleChildDidUpdate = () => {
        this.didUpdateEventEmitter.emit({});
    };
}

export class TextLayoutNode extends BaseLayoutNode<ITextStyle> implements ITextLayoutNode {
    readonly type = 'text';

    protected internalChildren: ITextLayoutNodeChild[] = [];
    protected internalFirstChild: ITextLayoutNodeChild | null = null;
    protected internalLastChild: ITextLayoutNodeChild | null = null;
    protected internalPreviousSibling: ITextLayoutNodeSibling | null = null;
    protected internalNextSibling: ITextLayoutNodeSibling | null = null;
    protected internalPreviousCrossParentSibling: ITextLayoutNodeSibling | null = null;
    protected internalNextCrossParentSibling: ITextLayoutNodeSibling | null = null;
    protected internalSize?: number;
    protected internalWidth?: number;
    protected internalHeight?: number;
    protected internalTrimmedWidth?: number;
    protected childDidUpdateDisposableMap: Map<string, IDisposable> = new Map();

    constructor(readonly renderId: string) {
        super();
        this.onDidUpdate(() => {
            this.internalSize = undefined;
            this.internalWidth = undefined;
            this.internalHeight = undefined;
            this.internalTrimmedWidth = undefined;
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

    get previousSibling() {
        return this.internalPreviousSibling;
    }

    get nextSibling() {
        return this.internalNextSibling;
    }

    get previousCrossParentSibling() {
        return this.internalPreviousCrossParentSibling;
    }

    get nextCrossParentSibling() {
        return this.internalNextCrossParentSibling;
    }

    get size() {
        if (this.internalSize === undefined) {
            this.internalSize = this.calculateSize();
        }
        return this.internalSize;
    }

    get width() {
        if (this.internalWidth === undefined) {
            this.internalWidth = this.calculateWidth();
        }
        return this.internalWidth;
    }

    get height() {
        if (this.internalHeight === undefined) {
            this.internalHeight = this.calculateHeight();
        }
        return this.internalHeight;
    }

    get trimmedWidth() {
        if (this.internalTrimmedWidth === undefined) {
            this.internalTrimmedWidth = this.calculateTrimmedWidth();
        }
        return this.internalTrimmedWidth;
    }

    setChildren(children: ITextLayoutNodeChild[]) {
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
                child.setPreviousSibling(previousSibling);
                child.setPreviousCrossParentSibling(previousSibling);
            } else {
                child.setPreviousSibling(null);
                child.previousCrossParentSibling?.setNextCrossParentSibling(null);
                let previousCrossParentSibling: IWordLayoutNodeSibling | null = null;
                switch (this.internalPreviousCrossParentSibling?.type) {
                    case 'text':
                        previousCrossParentSibling = this.internalPreviousCrossParentSibling.lastChild;
                        break;
                    case 'inline':
                        previousCrossParentSibling = this.internalPreviousCrossParentSibling;
                        break;
                }
                child.setPreviousCrossParentSibling(previousCrossParentSibling);
                switch (previousCrossParentSibling?.type) {
                    case 'word':
                        previousCrossParentSibling.setNextCrossParentSibling(child);
                        break;
                    case 'inline':
                        previousCrossParentSibling.setNextCrossParentContentSibling(child);
                        break;
                }
            }
            if (n < nn - 1) {
                const nextSibling = children[n + 1];
                child.setNextSibling(nextSibling);
                child.setNextCrossParentSibling(nextSibling);
            } else {
                child.setNextSibling(null);
                child.nextCrossParentSibling?.setPreviousCrossParentSibling(null);
                let nextCrossParentSibling: IWordLayoutNodeSibling | null = null;
                switch (this.internalNextCrossParentSibling?.type) {
                    case 'text':
                        nextCrossParentSibling = this.internalNextCrossParentSibling.firstChild;
                        break;
                    case 'inline':
                        nextCrossParentSibling = this.internalNextCrossParentSibling;
                        break;
                }
                child.setNextCrossParentSibling(nextCrossParentSibling);
                switch (nextCrossParentSibling?.type) {
                    case 'word':
                        nextCrossParentSibling.setPreviousCrossParentSibling(child);
                        break;
                    case 'inline':
                        nextCrossParentSibling.setPreviousCrossParentContentSibling(child);
                        break;
                }
            }
        }
        this.didUpdateEventEmitter.emit({});
    }

    setPreviousSibling(previousSibling: ITextLayoutNodeSibling | null) {
        this.internalPreviousSibling = previousSibling;
    }

    setNextSibling(nextSibling: ITextLayoutNodeSibling | null) {
        this.internalNextSibling = nextSibling;
    }

    setPreviousCrossParentSibling(previousCrossParentSibling: ITextLayoutNodeSibling | null) {
        this.internalPreviousCrossParentSibling = previousCrossParentSibling;
    }

    setNextCrossParentSibling(nextCrossParentSibling: ITextLayoutNodeSibling | null) {
        this.internalNextCrossParentSibling = nextCrossParentSibling;
    }

    convertCoordinatesToPosition(x: number, y: number) {
        return convertCoordinatesToPositionForHorizontallyFlowingNode(
            x,
            y,
            0,
            0,
            this.width,
            this.height,
            this.internalChildren,
        );
    }

    resolveBoundingBoxes(from: number, to: number) {
        if (from < 0 || to > this.size || from > to) {
            throw new Error('Invalid range.');
        }
        const result: IResolveBoundingBoxesResult = {
            node: this,
            boundingBoxes: [],
            children: [],
        };
        let cumulatedOffset = 0;
        let left1: number | null = null;
        let left2 = 0;
        for (const child of this.internalChildren) {
            if (cumulatedOffset > to) {
                break;
            }
            if (cumulatedOffset + child.size > from) {
                const childFrom = Math.max(0, from - cumulatedOffset);
                const childTo = Math.min(child.size, to - cumulatedOffset);
                const resolvedChild = child.resolveBoundingBoxes(childFrom, childTo);
                result.children.push(resolvedChild);
                if (left1 === null) {
                    left1 = left2 + resolvedChild.boundingBoxes[0].left;
                }
                left2 += resolvedChild.boundingBoxes
                    .slice(0, resolvedChild.boundingBoxes.length - 1)
                    .reduce((width, box) => width + box.left + box.width + box.right, 0);
                left2 += resolvedChild.boundingBoxes[0].left + resolvedChild.boundingBoxes[0].width;
            } else {
                left2 += child.width;
            }
            cumulatedOffset += child.size;
        }
        result.boundingBoxes.push({
            from,
            to,
            width: left2! - left1!,
            height: this.height,
            left: left1!,
            right: this.width - left2!,
            top: 0,
            bottom: 0,
        });
        return result;
    }

    describePosition(position: number): ILayoutPositionLayerDescription[] {
        return describePositionForNodeWithChildren(this, position);
    }

    protected calculateSize() {
        return this.internalChildren.reduce((size, child) => size + child.size, 0);
    }

    protected calculateWidth() {
        return this.internalChildren.reduce((width, child) => width + child.width, 0);
    }

    protected calculateHeight() {
        return this.internalChildren.reduce((height, child) => Math.max(height, child.height), 0);
    }

    protected calculateTrimmedWidth() {
        let trimmedWidth = 0;
        for (let n = 0, nn = this.internalChildren.length - 1; n < nn; n++) {
            trimmedWidth += this.internalChildren[n].width;
        }
        if (this.internalChildren.length > 0) {
            const lastChild = this.internalChildren[this.internalChildren.length - 1];
            trimmedWidth += lastChild.trimmedWidth;
        }
        return trimmedWidth;
    }

    protected handleChildDidUpdate = () => {
        this.didUpdateEventEmitter.emit({});
    };
}

export class WordLayoutNode extends BaseLayoutNode<ITextStyle> implements IWordLayoutNode {
    readonly type = 'word';

    protected internalPreviousSibling: IWordLayoutNodeSibling | null = null;
    protected internalNextSibling: IWordLayoutNodeSibling | null = null;
    protected internalPreviousCrossParentSibling: IWordLayoutNodeSibling | null = null;
    protected internalNextCrossParentSibling: IWordLayoutNodeSibling | null = null;
    protected internalContent: string = '';
    protected internalWhitespaceSize: number = 0;
    protected internalWidth?: number;
    protected internalHeight?: number;
    protected internalTrimmedWidth?: number;

    constructor(protected textService: ITextService) {
        super();
        this.onDidUpdate(() => {
            this.internalWidth = undefined;
            this.internalHeight = undefined;
            this.internalTrimmedWidth = undefined;
        });
    }

    get previousSibling() {
        return this.internalPreviousSibling;
    }

    get nextSibling() {
        return this.internalNextSibling;
    }

    get previousCrossParentSibling() {
        return this.internalPreviousCrossParentSibling;
    }

    get nextCrossParentSibling() {
        return this.internalNextCrossParentSibling;
    }

    get content() {
        return this.internalContent;
    }

    get whitespaceSize() {
        return this.internalWhitespaceSize;
    }

    get trimmedSize() {
        return this.size - this.whitespaceSize;
    }

    get size() {
        return this.internalContent.length;
    }

    get width() {
        if (this.internalWidth === undefined) {
            [this.internalWidth, this.internalHeight] = this.calculateWidthAndHeight();
        }
        return this.internalWidth;
    }

    get height() {
        if (this.internalHeight === undefined) {
            [this.internalWidth, this.internalHeight] = this.calculateWidthAndHeight();
        }
        return this.internalHeight;
    }

    get trimmedWidth() {
        if (this.internalTrimmedWidth === undefined) {
            this.internalTrimmedWidth = this.calculateTrimmedWidth();
        }
        return this.internalTrimmedWidth;
    }

    setPreviousSibling(previousSibling: IWordLayoutNodeSibling | null) {
        this.internalPreviousSibling = previousSibling;
    }

    setNextSibling(nextSibling: IWordLayoutNodeSibling | null) {
        this.internalNextSibling = nextSibling;
    }

    setPreviousCrossParentSibling(previousCrossParentSibling: IWordLayoutNodeSibling | null) {
        this.internalPreviousCrossParentSibling = previousCrossParentSibling;
    }

    setNextCrossParentSibling(nextCrossParentSibling: IWordLayoutNodeSibling | null) {
        this.internalNextCrossParentSibling = nextCrossParentSibling;
    }

    setContent(content: string) {
        this.internalContent = content;
    }

    setWhitespaceSize(whitespaceSize: number) {
        this.internalWhitespaceSize = whitespaceSize;
    }

    convertCoordinatesToPosition(x: number, y: number) {
        return this.searchForPosition(x, 0, this.internalContent.length, null, null) || this.internalContent.length - 1;
    }

    resolveBoundingBoxes(from: number, to: number): IResolveBoundingBoxesResult {
        if (from < 0 || to > this.size || from > to) {
            throw new Error('Invalid range.');
        }
        if (from === 0 && to === this.size) {
            return {
                node: this,
                boundingBoxes: [
                    {
                        from,
                        to,
                        width: this.width,
                        height: this.height,
                        left: 0,
                        right: 0,
                        top: 0,
                        bottom: 0,
                    },
                ],
                children: [],
            };
        }
        if (from === to) {
            const left = this.textService.measure(this.internalContent.slice(0, from), this.internalStyle!).width;
            return {
                node: this,
                boundingBoxes: [
                    {
                        from,
                        to,
                        width: 0,
                        height: this.height,
                        left: left,
                        right: this.width - left,
                        top: 0,
                        bottom: 0,
                    },
                ],
                children: [],
            };
        }
        const left1 = this.textService.measure(this.internalContent.slice(0, from), this.internalStyle!).width;
        const left2 = this.textService.measure(this.internalContent.slice(0, to), this.internalStyle!).width;
        return {
            node: this,
            boundingBoxes: [
                {
                    from,
                    to,
                    width: left2 - left1,
                    height: this.height,
                    left: left1,
                    right: this.width - left2,
                    top: 0,
                    bottom: 0,
                },
            ],
            children: [],
        };
    }

    describePosition(position: number): ILayoutPositionLayerDescription[] {
        if (position < 0 || position >= this.size) {
            throw new Error('Invalid position.');
        }
        return [{ node: this, position }];
    }

    protected calculateWidthAndHeight() {
        const measurement = this.textService.measure(this.content, this.internalStyle!);
        return [measurement.width, measurement.height];
    }

    protected calculateTrimmedWidth() {
        const trimmedText = this.content.substring(0, this.content.length - this.whitespaceSize);
        return this.textService.measure(trimmedText, this.internalStyle!).width;
    }

    protected searchForPosition(
        x: number,
        from: number,
        to: number,
        fromX: number | null,
        toX: number | null,
    ): number | null {
        if (fromX === null) {
            const measurement = this.textService.measure(this.content.substring(0, from), this.internalStyle!);
            fromX = measurement.width;
        }
        if (toX === null) {
            const measurement = this.textService.measure(this.content.substring(0, to), this.internalStyle!);
            toX = measurement.width;
        }
        if (x < fromX || x > toX) {
            return null;
        }
        if (to - from === 1) {
            return x - fromX < toX - x ? from : to;
        }
        const mid = Math.floor((from + to) / 2);
        return this.searchForPosition(x, from, mid, fromX, null) || this.searchForPosition(x, mid, to, null, toX);
    }
}

export class InlineLayoutNode extends BaseLayoutNode<IInlineStyle> implements IInlineLayoutNode {
    readonly type = 'inline';
    protected internalPreviousSibling: IInlineLayoutNodeSibling | null = null;
    protected internalNextSibling: IInlineLayoutNodeSibling | null = null;
    protected internalPreviousCrossParentSibling: IInlineLayoutNodeSibling | null = null;
    protected internalNextCrossParentSibling: IInlineLayoutNodeSibling | null = null;
    protected internalPreviousContentSibling: IInlineLayoutNodeContentSibling | null = null;
    protected internalNextContentSibling: IInlineLayoutNodeContentSibling | null = null;
    protected internalPreviousCrossParentContentSibling: IInlineLayoutNodeContentSibling | null = null;
    protected internalNextCrossParentContentSibling: IInlineLayoutNodeContentSibling | null = null;
    readonly size = 1;
    readonly trimmedSize = 1;

    constructor(readonly renderId: string) {
        super();
    }

    get previousSibling() {
        return this.internalPreviousSibling;
    }

    get nextSibling() {
        return this.internalNextSibling;
    }

    get previousCrossParentSibling() {
        return this.internalPreviousCrossParentSibling;
    }

    get nextCrossParentSibling() {
        return this.internalNextCrossParentSibling;
    }

    get previousContentSibling() {
        return this.internalPreviousContentSibling;
    }

    get nextContentSibling() {
        return this.internalNextContentSibling;
    }

    get previousCrossParentContentSibling() {
        return this.internalPreviousCrossParentContentSibling;
    }

    get nextCrossParentContentSibling() {
        return this.internalNextCrossParentContentSibling;
    }

    get width() {
        if (!this.internalStyle) {
            return 0;
        }
        return this.internalStyle.width;
    }

    get height() {
        if (!this.internalStyle) {
            return 0;
        }
        return this.internalStyle.height;
    }

    setPreviousSibling(previousSibling: IInlineLayoutNodeSibling | null) {
        this.internalPreviousSibling = previousSibling;
    }

    setNextSibling(nextSibling: IInlineLayoutNodeSibling | null) {
        this.internalNextSibling = nextSibling;
    }

    setPreviousCrossParentSibling(previousCrossParentSibling: IInlineLayoutNodeSibling | null) {
        this.internalPreviousCrossParentSibling = previousCrossParentSibling;
    }

    setNextCrossParentSibling(nextCrossParentSibling: IInlineLayoutNodeSibling | null) {
        this.internalNextCrossParentSibling = nextCrossParentSibling;
    }

    setPreviousContentSibling(previousContentSibling: IInlineLayoutNodeContentSibling | null) {
        this.internalPreviousContentSibling = previousContentSibling;
    }

    setNextContentSibling(nextContentSibling: IInlineLayoutNodeContentSibling | null) {
        this.internalNextContentSibling = nextContentSibling;
    }

    setPreviousCrossParentContentSibling(previousCrossParentContentSibling: IInlineLayoutNodeContentSibling | null) {
        this.internalPreviousCrossParentContentSibling = previousCrossParentContentSibling;
    }

    setNextCrossParentContentSibling(nextCrossParentContentSibling: IInlineLayoutNodeContentSibling | null) {
        this.internalNextCrossParentContentSibling = nextCrossParentContentSibling;
    }

    convertCoordinatesToPosition(x: number, y: number) {
        return x < this.width / 2 ? 0 : 1;
    }

    resolveBoundingBoxes(from: number, to: number): IResolveBoundingBoxesResult {
        if (from < 0 || to > this.size || from > to) {
            throw new Error('Invalid range.');
        }
        return {
            node: this,
            boundingBoxes: [
                {
                    from,
                    to,
                    width: from === to ? 0 : this.width,
                    height: this.height,
                    left: from === 0 ? 0 : this.width,
                    right: to === 1 ? 0 : this.width,
                    top: 0,
                    bottom: 0,
                },
            ],
            children: [],
        };
    }

    describePosition(position: number): ILayoutPositionLayerDescription[] {
        if (position < 0 || position >= this.size) {
            throw new Error('Invalid position.');
        }
        return [{ node: this, position }];
    }
}

interface IVerticallyFlowingNodeChild {
    readonly height: number;
    readonly size: number;
    convertCoordinatesToPosition: (x: number, y: number) => number;
}

function convertCoordinatesToPositionForVerticallyFlowingNode(
    x: number,
    y: number,
    paddingLeft: number,
    paddingTop: number,
    contentWidth: number,
    contentHeight: number,
    children: IVerticallyFlowingNodeChild[],
) {
    let cumulatedHeight = 0;
    let cumulatedPosition = 0;
    const contentX = Math.min(Math.max(x - paddingLeft, 0), contentWidth);
    const contentY = Math.min(Math.max(y - paddingTop, 0), contentHeight);
    for (let n = 0, nn = children.length; n < nn; n++) {
        const child = children[n];
        const childHeight = child.height;
        if (contentY >= cumulatedHeight && contentY <= cumulatedHeight + childHeight) {
            const childPosition = child.convertCoordinatesToPosition(contentX, contentY - cumulatedHeight);
            return cumulatedPosition + childPosition;
        }
        cumulatedHeight += childHeight;
        cumulatedPosition += child.size;
    }
    const lastChild = children[children.length - 1];
    const lastChildPosition = lastChild.convertCoordinatesToPosition(contentX, lastChild.height);
    return cumulatedPosition - lastChild.size + lastChildPosition;
}

interface IHorizontallyFlowingNodeChild {
    readonly width: number;
    readonly size: number;
    convertCoordinatesToPosition: (x: number, y: number) => number;
}

function convertCoordinatesToPositionForHorizontallyFlowingNode(
    x: number,
    y: number,
    paddingLeft: number,
    paddingTop: number,
    contentWidth: number,
    contentHeight: number,
    children: IHorizontallyFlowingNodeChild[],
) {
    let cumulatedWidth = 0;
    let cumulatedPosition = 0;
    const contentX = Math.min(Math.max(x - paddingLeft, 0), contentWidth);
    const contentY = Math.min(Math.max(y - paddingTop, 0), contentHeight);
    for (let n = 0, nn = children.length; n < nn; n++) {
        const child = children[n];
        const childWidth = child.width;
        if (contentX >= cumulatedWidth && contentX <= cumulatedWidth + childWidth) {
            const childPosition = child.convertCoordinatesToPosition(contentX - cumulatedWidth, contentY);
            return cumulatedPosition + childPosition;
        }
        cumulatedWidth += childWidth;
    }
    const lastChild = children[children.length - 1];
    const lastChildPosition = lastChild.convertCoordinatesToPosition(lastChild.width, contentY);
    return cumulatedPosition - lastChild.size + lastChildPosition;
}

type INodeWithChildren = ILayoutNode & {
    readonly children: ILayoutNode[];
};

function describePositionForNodeWithChildren(node: INodeWithChildren, position: number) {
    if (position < 0 || position >= node.size) {
        throw new Error('Invalid position.');
    }
    let cumulatedOffset = 0;
    for (const child of node.children) {
        if (cumulatedOffset + child.size > position && cumulatedOffset <= position) {
            const childPosition = position - cumulatedOffset;
            return [{ node, position }, ...child.describePosition(childPosition)];
        }
        cumulatedOffset += child.size;
    }
    throw new Error('Error describing position.');
}
