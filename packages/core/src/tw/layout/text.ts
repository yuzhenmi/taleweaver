import { IFont } from '../text/service';
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
        children: ILayoutNode[],
        paddingTop: number,
        paddingBottom: number,
        paddingLeft: number,
        paddingRight: number,
        readonly font: IFont,
    ) {
        super(renderId, '', children, paddingTop, paddingBottom, paddingLeft, paddingRight);
    }

    get type(): ILayoutNodeType {
        return 'text';
    }

    get root() {
        return false;
    }

    get leaf() {
        return false;
    }

    get width() {
        if (this.internalWidth === undefined) {
            this.internalWidth = this.children.reduce((width, child) => width + child.width, this.paddingHorizontal);
        }
        return this.internalWidth;
    }

    get height() {
        if (this.internalHeight === undefined) {
            this.internalHeight =
                this.children.reduce((height, child) => Math.max(height, child.height), 0) + this.paddingVertical;
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
            if (cumulatedWidth + childWidth >= x) {
                offset += child.convertCoordinatesToOffset(x - cumulatedWidth, 0);
                break;
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
        if (from < 0 || to > this.size || from > to) {
            throw new Error('Invalid range.');
        }
        const childResults: IResolveBoundingBoxesResult[] = [];
        let cumulatedOffset = 0;
        let left1: number | null = null;
        let left2 = 0;
        for (let n = 0, nn = this.children.length; n < nn; n++) {
            if (cumulatedOffset > to) {
                break;
            }
            const child = this.children.at(n);
            if (cumulatedOffset + child.size > from) {
                const childFrom = Math.max(0, from - cumulatedOffset);
                const childTo = Math.min(child.size, to - cumulatedOffset);
                const childResult = child.resolveBoundingBoxes(childFrom, childTo);
                childResults.push(childResult);
                if (left1 === null) {
                    left1 = left2 + childResult.boundingBoxes[0].left;
                }
                left2 += childResult.boundingBoxes
                    .slice(0, childResult.boundingBoxes.length - 1)
                    .reduce((width, box) => width + box.left + box.width + box.right, 0);
                left2 += childResult.boundingBoxes[0].left + childResult.boundingBoxes[0].width;
            } else {
                left2 += child.width;
            }
            cumulatedOffset += child.size;
        }
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
