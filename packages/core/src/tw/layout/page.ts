import { ILayoutNode, ILayoutNodeType, LayoutNode } from './node';
import { ILayoutRect } from './rect';

export interface ILayoutPage extends ILayoutNode {
    readonly contentHeight: number;

    convertCoordinatesToOffset(x: number, y: number): number;
    resolveRects(from: number, to: number): ILayoutRect[];
}

export class LayoutPage extends LayoutNode implements ILayoutPage {
    protected internalContentHeight?: number;

    constructor(
        readonly width: number,
        readonly height: number,
        paddingTop: number,
        paddingBottom: number,
        paddingLeft: number,
        paddingRight: number,
    ) {
        super(null, '', paddingTop, paddingBottom, paddingLeft, paddingRight);
        this.onDidUpdateNode(() => {
            this.internalContentHeight = undefined;
        });
    }

    get type(): ILayoutNodeType {
        return 'page';
    }

    get root() {
        return false;
    }

    get leaf() {
        return false;
    }

    get contentHeight() {
        if (this.internalContentHeight === undefined) {
            this.internalContentHeight = this.children.reduce(
                (contentHeight, child) => contentHeight + child.height,
                0,
            );
        }
        return this.internalContentHeight;
    }

    convertCoordinatesToOffset(x: number, y: number) {
        let offset = 0;
        let cumulatedHeight = 0;
        const contentX = Math.min(Math.max(x - this.getPaddingLeft(), 0), this.getWidth() - this.getPaddingRight());
        const contentY = Math.min(Math.max(y - this.getPaddingTop(), 0), this.getHeight() - this.getPaddingBottom());
        for (let child of this.getChildren()) {
            const childHeight = child.getHeight();
            if (contentY >= cumulatedHeight && contentY <= cumulatedHeight + childHeight) {
                offset += child.convertCoordinatesToOffset(contentX, contentY - cumulatedHeight);
                break;
            }
            offset += child.getSize();
            cumulatedHeight += childHeight;
        }
        if (offset === this.getSize()) {
            const lastChild = this.getLastChild();
            if (lastChild) {
                offset -= lastChild.getSize();
                offset += lastChild.convertCoordinatesToOffset(contentX, lastChild.getHeight());
            }
        }
        if (offset === this.getSize()) {
            offset--;
        }
        return offset;
    }

    resolveRects(from: number, to: number) {
        const rects: ILayoutRect[] = [];
        let offset = 0;
        let cumulatedHeight = 0;
        this.getChildren().forEach((child, n) => {
            const childHeight = child.getHeight();
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
                    const paddingLeft = this.getPaddingLeft();
                    const paddingRight = this.getPaddingRight();
                    const left = paddingLeft + childRect.left;
                    const right = paddingRight + childRect.right;
                    const top = cumulatedHeight + paddingTop + childRect.top;
                    const bottom = this.getHeight() - cumulatedHeight - childHeight - childRect.bottom - paddingBottom;
                    rects.push({
                        width,
                        height,
                        left,
                        right,
                        top,
                        bottom,
                        paddingTop: childRect.paddingTop,
                        paddingBottom: childRect.paddingBottom,
                        paddingLeft: childRect.paddingLeft,
                        paddingRight: childRect.paddingRight,
                    });
                });
            }
            offset += child.getSize();
            cumulatedHeight += childHeight;
        });
        return rects;
    }
}
