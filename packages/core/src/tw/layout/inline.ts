import { ILayoutNode, ILayoutNodeType, LayoutNode } from './node';
import { ILayoutRect } from './rect';

export interface ILayoutInline extends ILayoutNode {
    readonly trimmedWidth: number;

    convertCoordinateToOffset(x: number): number;
    resolveRects(from: number, to: number): ILayoutRect[];
    clone(): ILayoutInline;
}

export abstract class LayoutInline extends LayoutNode implements ILayoutInline {
    abstract clone(): ILayoutInline;

    protected internalWidth?: number;
    protected internalHeight?: number;
    protected internalTrimmedWidth?: number;

    constructor(componentId: string, id: string, children: ILayoutNode[]) {
        super(componentId, id, children, '');
        this.onDidUpdateNode(() => {
            this.internalWidth = undefined;
            this.internalHeight = undefined;
            this.internalTrimmedWidth = undefined;
        });
    }

    get type(): ILayoutNodeType {
        return 'inline';
    }

    get root() {
        return false;
    }

    get leaf() {
        return false;
    }

    get width() {
        if (this.internalWidth === undefined) {
            this.internalWidth = this.children.reduce((width, child) => width + child.width, this.horizontalPadding);
        }
        return this.internalWidth;
    }

    get height() {
        if (this.internalHeight === undefined) {
            this.internalHeight =
                this.children.reduce((height, child) => Math.max(height, child.height), 0) + this.verticalPaddng;
        }
        return this.internalHeight;
    }

    get trimmedWidth() {
        if (this.internalTrimmedWidth === undefined) {
            const lastChild = this.lastChild;
            if (lastChild) {
                this.internalTrimmedWidth = this.width - lastChild.width + lastChild.trimmedWidth;
            } else {
                this.internalTrimmedWidth = 0;
            }
        }
        return this.internalTrimmedWidth;
    }

    convertCoordinateToOffset(x: number) {
        let offset = 0;
        let cumulatedWidth = 0;
        for (let child of this.getChildren()) {
            const childWidth = child.getWidth();
            if (x >= cumulatedWidth && x <= cumulatedWidth + childWidth) {
                offset += child.convertCoordinateToOffset(x - cumulatedWidth);
                break;
            }
            offset += child.getSize();
            cumulatedWidth += childWidth;
        }
        return offset;
    }

    resolveRects(from: number, to: number) {
        const rects: ILayoutRect[] = [];
        let offset = 0;
        let cumulatedWidth = 0;
        this.getChildren().forEach((child, n) => {
            const childWidth = child.getWidth();
            const minChildOffset = 0;
            const maxChildOffset = child.getSize();
            const childFrom = Math.max(from - offset, minChildOffset);
            const childTo = Math.min(to - offset, maxChildOffset);
            if (childFrom <= maxChildOffset && childTo >= minChildOffset) {
                const childRects = child.resolveRects(childFrom, childTo);
                childRects.forEach((childRect) => {
                    const width = childRect.width;
                    const height = childRect.height;
                    const paddingTop = this.getPaddingTop();
                    const paddingBottom = this.getPaddingBottom();
                    const left = cumulatedWidth + childRect.left;
                    const right = this.getWidth() - cumulatedWidth - childRect.right;
                    const top = paddingTop + childRect.top;
                    const bottom = paddingBottom + childRect.bottom;
                    rects.push({
                        width,
                        height,
                        left,
                        right,
                        top,
                        bottom,
                        paddingTop,
                        paddingBottom,
                        paddingLeft: 0,
                        paddingRight: 0,
                    });
                });
            }
            offset += child.getSize();
            cumulatedWidth += childWidth;
        });
        return rects;
    }
}
