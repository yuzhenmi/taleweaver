import { ILayoutNode, LayoutNode } from './node';
import { ILayoutRect } from './rect';

export interface ILayoutBlock extends ILayoutNode {
    readonly type: 'block';

    convertCoordinatesToOffset(x: number, y: number): number;
    resolveRects(from: number, to: number): ILayoutRect[];
}

export class LayoutBlock extends LayoutNode implements ILayoutBlock {
    protected internalHeight?: number;

    constructor(
        renderId: string | null,
        readonly width: number,
        paddingTop: number,
        paddingBottom: number,
        paddingLeft: number,
        paddingRight: number,
    ) {
        super(renderId, '', paddingTop, paddingBottom, paddingLeft, paddingRight);
        this.onDidUpdateNode(() => {
            this.internalHeight = undefined;
        });
    }

    get type(): 'block' {
        return 'block';
    }

    get root() {
        return false;
    }

    get leaf() {
        return false;
    }

    get height() {
        if (this.internalHeight === undefined) {
            this.internalHeight = this.children.reduce((height, child) => height + child.height, this.paddingVertical);
        }
        return this.internalHeight;
    }

    convertCoordinatesToOffset(x: number, y: number) {
        let offset = 0;
        let cumulatedHeight = 0;
        for (let child of this.getChildren()) {
            const childHeight = child.getHeight();
            if (y >= cumulatedHeight && y <= cumulatedHeight + childHeight) {
                offset += child.convertCoordinateToOffset(x);
                break;
            }
            offset += child.getSize();
            cumulatedHeight += childHeight;
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
                    const left = childRect.left;
                    const right = childRect.right;
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
