import { IFont } from '../render/font';
import { ILayoutNode, ILayoutNodeType, LayoutNode } from './node';
import { ILayoutRect } from './rect';
import { ILayoutWord } from './word';

export interface ILayoutText extends ILayoutNode {
    readonly font: IFont;
    readonly trimmedWidth: number;

    convertCoordinateToOffset(x: number): number;
    resolveRects(from: number, to: number): ILayoutRect[];
}

export class LayoutText extends LayoutNode implements ILayoutText {
    abstract convertCoordinateToOffset(x: number): number;
    abstract resolveRects(from: number, to: number): ILayoutRect[];

    protected internalWidth?: number;
    protected internalHeight?: number;
    protected internalTrimmedWidth?: number;

    constructor(
        renderId: string | null,
        paddingTop: number,
        paddingBottom: number,
        paddingLeft: number,
        paddingRight: number,
        readonly font: IFont,
    ) {
        super(renderId, '', paddingTop, paddingBottom, paddingLeft, paddingRight);
    }

    get type(): ILayoutNodeType {
        return 'text';
    }

    get root() {
        return false;
    }

    get leaf() {
        return true;
    }

    get width() {
        if (this.internalWidth === undefined) {
            this.internalWidth = this.children.reduce((width, child) => width + child.width, 0);
        }
        return this.internalWidth;
    }

    get height() {
        if (this.internalHeight === undefined) {
            this.internalHeight = this.children.reduce((height, child) => Math.max(height, child.height), 0);
        }
        return this.internalHeight;
    }

    get trimmedWidth() {
        if (this.internalTrimmedWidth === undefined) {
            const lastChild = this.lastChild as ILayoutWord | null;
            if (!lastChild) {
                this.internalTrimmedWidth = 0;
            } else {
                this.internalTrimmedWidth = this.width - lastChild.width + lastChild.trimmedWidth;
            }
        }
        return this.internalTrimmedWidth;
    }
}
