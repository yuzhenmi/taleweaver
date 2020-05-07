import { ILayoutNode, ILayoutNodeType, LayoutNode } from './node';
import { ILayoutRect } from './rect';

export interface ILayoutPage extends ILayoutNode {
    readonly contentHeight: number;
    readonly flowed: boolean;

    markAsFlowed(): void;
    convertCoordinatesToOffset(x: number, y: number): number;
    resolveRects(from: number, to: number): ILayoutRect[];
    clone(): ILayoutPage;
}

export abstract class LayoutPage extends LayoutNode implements ILayoutPage {
    abstract clone(): ILayoutPage;

    protected internalWidth: number;
    protected internalHeight: number;
    protected internalPaddingTop: number;
    protected internalPaddingBottom: number;
    protected internalPaddingLeft: number;
    protected internalPaddingRight: number;
    protected internalContentHeight?: number;
    protected internalFlowed = false;

    constructor(
        width: number,
        height: number,
        paddingTop: number,
        paddingBottom: number,
        paddingLeft: number,
        paddingRight: number,
    ) {
        super();
        this.internalWidth = width;
        this.internalHeight = height;
        this.internalPaddingTop = paddingTop;
        this.internalPaddingBottom = paddingBottom;
        this.internalPaddingLeft = paddingLeft;
        this.internalPaddingRight = paddingRight;
        this.onDidUpdateNode(() => {
            this.internalContentHeight = undefined;
            this.internalFlowed = false;
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

    get width() {
        return this.internalWidth;
    }

    get height() {
        return this.internalHeight;
    }

    get paddingTop() {
        return this.internalPaddingTop;
    }

    get paddingBottom() {
        return this.internalPaddingBottom;
    }

    get paddingLeft() {
        return this.internalPaddingLeft;
    }

    get paddingRight() {
        return this.internalPaddingRight;
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

    get flowed() {
        return this.internalFlowed;
    }

    markAsFlowed() {
        this.internalFlowed = true;
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
