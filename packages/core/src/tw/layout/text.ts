import { IFont } from '../render/font';
import { ILayoutNode, ILayoutNodeType, IResolveBoundingBoxesResult, LayoutNode } from './node';
import { ILayoutWord } from './word';

export interface ILayoutText extends ILayoutNode {
    readonly font: IFont;
    readonly trimmedWidth: number;
}

export class LayoutText extends LayoutNode implements ILayoutText {
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
        this.onDidUpdateNode(() => {
            this.internalWidth = undefined;
            this.internalHeight = undefined;
            this.internalTrimmedWidth = undefined;
        });
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

    convertCoordinatesToOffset(x: number, y: number) {
        let offset = 0;
        let cumulatedWidth = 0;
        for (let n = 0, nn = this.children.length; n < nn; n++) {
            const child = this.children.at(n);
            const childWidth = child.width;
            if (x >= cumulatedWidth && x <= cumulatedWidth + childWidth) {
                offset += child.convertCoordinatesToOffset(x, 0);
            }
            offset += child.size;
            cumulatedWidth += childWidth;
        }
        if (offset === this.size) {
            return offset - 1;
        }
        return offset;
    }

    resolveBoundingBoxes(from: number, to: number): IResolveBoundingBoxesResult {
        if (from < 0 || to >= this.size || from > to) {
            throw new Error('Invalid range.');
        }
        const childResults: IResolveBoundingBoxesResult[] = [];
        let cumulatedOffset = 0;
        let cumulatedWidth = 0;
        let left1: number;
        let left2: number;
        this.children.forEach((child) => {
            if (cumulatedOffset + child.size > from && cumulatedOffset < to) {
                const childFrom = Math.max(0, from - cumulatedOffset);
                const childTo = Math.min(child.size, to - cumulatedOffset);
                const childResult = child.resolveBoundingBoxes(childFrom, childTo);
                childResults.push(childResult);
                if (left1 === undefined) {
                    left1 = cumulatedWidth + childResult.boundingBoxes[0].left;
                }
                left2 =
                    cumulatedWidth +
                    childResult.boundingBoxes.reduce((width, boundingBox) => width + boundingBox.width, 0) -
                    childResult.boundingBoxes[childResult.boundingBoxes.length - 1].right;
            }
            cumulatedOffset += child.size;
            cumulatedWidth += child.width;
        });
        return {
            node: this,
            boundingBoxes: [
                {
                    from,
                    to,
                    width: left2! - left1!,
                    height: this.innerHeight,
                    left: this.paddingLeft + left1!,
                    right: this.width - this.paddingLeft - left2!,
                    top: this.paddingTop,
                    bottom: this.paddingBottom,
                },
            ],
            children: childResults,
        };
    }
}
