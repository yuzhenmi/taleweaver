import { IModelPosition } from '../model/position';
import { INode, Node } from '../tree/node';
import { NodeList } from '../tree/node-list';
import { generateId } from '../util/id';
import { IResolvedBoundingBoxes } from './bounding-box';
import { IResolvedPosition } from './position';

export type ILayoutNodeType = 'doc' | 'page' | 'block' | 'line' | 'text' | 'word' | 'atom';

export interface ILayoutNode extends INode<ILayoutNode> {
    readonly type: ILayoutNodeType;
    readonly modelId: string | null;
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
    resolvePosition(position: IModelPosition): IResolvedPosition;
    convertCoordinatesToPosition(x: number, y: number): IModelPosition;
    resolveBoundingBoxes(from: IResolvedPosition | null, to: IResolvedPosition | null): IResolvedBoundingBoxes;
}

export abstract class LayoutNode extends Node<ILayoutNode> implements ILayoutNode {
    abstract get type(): ILayoutNodeType;
    abstract get width(): number;
    abstract get height(): number;

    abstract resolveBoundingBoxes(from: IResolvedPosition, to: IResolvedPosition): IResolvedBoundingBoxes;
    abstract convertCoordinatesToPosition(x: number, y: number): IModelPosition;

    protected internalSize?: number;
    protected internalNeedView = true;

    constructor(
        readonly modelId: string | null,
        readonly renderId: string | null,
        readonly text: string,
        children: ILayoutNode[],
        readonly paddingTop: number,
        readonly paddingBottom: number,
        readonly paddingLeft: number,
        readonly paddingRight: number,
    ) {
        super(generateId());
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

    resolvePosition(position: IModelPosition): IResolvedPosition {
        const offset = this.boundOffset(position[0]);
        const resolvedPosition: IResolvedPosition = [];
        if (this.leaf) {
            resolvedPosition.push({ node: this, offset });
        } else if (this.renderId === null) {
            let cumulatedOffset = 0;
            for (let n = 0, nn = this.children.length; n < nn; n++) {
                const child = this.children.at(n);
                for (let m = 0, mm = child.children.length; m < mm; m++) {
                    const grandchild = child.children.at(m);
                    if (grandchild.modelId) {
                        if (cumulatedOffset === position[0]) {
                            resolvedPosition.push(
                                { node: this, offset: n },
                                { node: child, offset: m },
                                ...grandchild.resolvePosition(position.slice(1)),
                            );
                        }
                        cumulatedOffset++;
                    }
                }
            }
        } else {
            let cumulatedOffset = 0;
            for (let n = 0, nn = this.children.length; n < nn; n++) {
                const child = this.children.at(n);
                if (child.modelId) {
                    if (cumulatedOffset === position[0]) {
                        resolvedPosition.push({ node: this, offset: n }, ...child.resolvePosition(position.slice(1)));
                    }
                    cumulatedOffset++;
                }
            }
        }
        return resolvedPosition;
    }
}
