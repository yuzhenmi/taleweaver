import { IRenderPosition } from '../render/position';
import { INode, Node } from '../tree/node';
import { NodeList } from '../tree/node-list';
import { IResolvedBoundingBoxes } from './bounding-box';
import { IResolvedLayoutPosition } from './position';

export type ILayoutNodeType = 'doc' | 'page' | 'block' | 'line' | 'text' | 'word' | 'atom';

export interface ILayoutNode extends INode<ILayoutNode> {
    readonly type: ILayoutNodeType;
    readonly renderId: string | null;
    readonly text: string;
    readonly size: number;
    readonly width: number;
    readonly height: number;
    readonly paddingTop: number;
    readonly paddingBottom: number;
    readonly paddingLeft: number;
    readonly paddingRight: number;
    readonly paddingVertical: number;
    readonly paddingHorizontal: number;
    readonly innerWidth: number;
    readonly innerHeight: number;
    readonly needView: boolean;

    clearNeedView(): void;
    resolvePosition(position: IRenderPosition): IResolvedLayoutPosition;
    convertCoordinatesToPosition(x: number, y: number): IRenderPosition;
    resolveBoundingBoxes(from: IRenderPosition, to: IRenderPosition): IResolvedBoundingBoxes;
}

export abstract class LayoutNode extends Node<ILayoutNode> implements ILayoutNode {
    abstract get type(): ILayoutNodeType;
    abstract get width(): number;
    abstract get height(): number;

    abstract resolveBoundingBoxes(from: IRenderPosition, to: IRenderPosition): IResolvedBoundingBoxes;
    abstract convertCoordinatesToPosition(x: number, y: number): IRenderPosition;

    protected internalSize?: number;
    protected internalNeedView = true;

    constructor(
        id: string,
        readonly renderId: string | null,
        readonly text: string,
        children: ILayoutNode[],
        readonly paddingTop: number,
        readonly paddingBottom: number,
        readonly paddingLeft: number,
        readonly paddingRight: number,
    ) {
        super(id);
        this.internalChildren = new NodeList(children);
        children.forEach((child) => {
            child.parent = this;
        });
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
                this.internalSize = this.text.length;
            } else {
                this.internalSize = this.children.reduce((size, child) => size + child.size, 0);
            }
        }
        return this.internalSize;
    }

    get paddingVertical() {
        return this.paddingTop + this.paddingBottom;
    }

    get paddingHorizontal() {
        return this.paddingLeft + this.paddingRight;
    }

    get innerWidth() {
        return this.width - this.paddingHorizontal;
    }

    get innerHeight() {
        return this.height - this.paddingVertical;
    }

    get needView() {
        return this.internalNeedView;
    }

    clearNeedView() {
        this.internalNeedView = false;
    }

    resolvePosition(position: IRenderPosition): IResolvedLayoutPosition {
        if (position < 0 || position >= this.size) {
            throw new Error(`Offset ${position} is out of range.`);
        }
        if (this.leaf) {
            return [{ node: this, offset: position, position }];
        }
        let cumulatedSize = 0;
        for (let n = 0, nn = this.children.length; n < nn; n++) {
            const child = this.children.at(n);
            const childSize = child.size;
            if (cumulatedSize + childSize > position) {
                return [{ node: this, offset: n, position }, ...child.resolvePosition(position - cumulatedSize)];
            }
            cumulatedSize += childSize;
        }
        throw new Error('Offset cannot be resolved.');
    }
}
