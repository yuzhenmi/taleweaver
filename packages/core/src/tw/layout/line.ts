import { generateId } from '../util/id';
import { ILayoutNode, ILayoutNodeType, LayoutNode } from './node';
import { ILayoutRect, mergeLayoutRects } from './rect';

export interface ILayoutLine extends ILayoutNode {
    readonly contentWidth: number;
    readonly flowed: boolean;

    markAsFlowed(): void;
    convertCoordinateToOffset(x: number): number;
    resolveRects(from: number, to: number): ILayoutRect[];
    clone(): ILayoutLine;
}

export abstract class LayoutLine extends LayoutNode implements ILayoutLine {
    abstract clone(): ILayoutLine;

    protected internalHeight?: number;
    protected internalContentWidth?: number;
    protected internalFlowed = false;

    constructor(componentId: string, children: ILayoutNode[], readonly width: number) {
        super(componentId, generateId(), children, '');
        this.onDidUpdateNode(() => {
            this.internalHeight = undefined;
            this.internalContentWidth = undefined;
            this.internalFlowed = false;
        });
    }

    get type(): ILayoutNodeType {
        return 'line';
    }

    get root() {
        return false;
    }

    get leaf() {
        return false;
    }

    get height() {
        if (this.internalHeight === undefined) {
            this.internalHeight = this.children.reduce(
                (height, child) => Math.max(height, child.height),
                this.verticalPaddng,
            );
        }
        return this.internalHeight;
    }

    get paddingTop() {
        return 0;
    }

    get paddingBottom() {
        return 0;
    }

    get paddingLeft() {
        return 0;
    }

    get paddingRight() {
        return 0;
    }

    get contentWidth() {
        if (this.internalContentWidth === undefined) {
            this.internalContentWidth = this.children.reduce((contentWidth, child) => contentWidth + child.width, 0);
        }
        return this.internalContentWidth;
    }

    get flowed() {
        return this.internalFlowed;
    }

    markAsFlowed() {
        this.internalFlowed = true;
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
        if (offset === this.getSize()) {
            return offset - 1;
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
            if (
                childFrom <= maxChildOffset &&
                childTo >= minChildOffset &&
                !(childFrom === childTo && childTo === maxChildOffset)
            ) {
                const childRects = child.resolveRects(childFrom, childTo);
                childRects.forEach((childRect) => {
                    const width = childRect.width;
                    const height = childRect.height;
                    const left = cumulatedWidth + childRect.left;
                    const right = this.getWidth() - cumulatedWidth - childRect.right;
                    const top = childRect.top;
                    const bottom = childRect.bottom;
                    rects.push({
                        width,
                        height,
                        left,
                        right,
                        top,
                        bottom,
                        paddingTop: childRect.paddingTop,
                        paddingBottom: childRect.paddingBottom,
                        paddingLeft: 0,
                        paddingRight: 0,
                    });
                });
            }
            offset += child.getSize();
            cumulatedWidth += childWidth;
        });
        mergeLayoutRects(rects);
        return rects;
    }
}
