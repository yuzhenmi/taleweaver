import { ILayoutNode, ILayoutNodeClass, ILayoutPosition, LayoutNode, LayoutPosition } from './node';
import { IPageLayoutNode } from './page-node';
import { IPageLayoutRect } from './rect';

export interface IDocLayoutNode extends ILayoutNode<never, IPageLayoutNode> {
    resolvePageRects(from: number, to: number): IPageLayoutRect[];
}

export abstract class DocLayoutNode extends LayoutNode<never, IPageLayoutNode> implements IDocLayoutNode {
    protected size?: number;

    getNodeClass(): ILayoutNodeClass {
        return 'doc';
    }

    isRoot() {
        return true;
    }

    isLeaf() {
        return false;
    }

    getSize() {
        if (this.size === undefined) {
            this.size = this.getChildren().reduce((size, child) => size + child.getSize(), 0);
        }
        return this.size!;
    }

    getWidth() {
        return 0;
    }

    getHeight() {
        return 0;
    }

    getPaddingTop() {
        return 0;
    }

    getPaddingBottom() {
        return 0;
    }

    getPaddingLeft() {
        return 0;
    }

    getPaddingRight() {
        return 0;
    }

    resolvePosition(offset: number): ILayoutPosition {
        let cumulatedOffset = 0;
        for (let child of this.getChildren()) {
            const childSize = child.getSize();
            if (cumulatedOffset + childSize > offset) {
                const position = new LayoutPosition(this, 0, offset);
                const childPosition = child.resolvePosition(offset - cumulatedOffset, 1);
                position.setChild(childPosition);
                childPosition.setParent(position);
                return position;
            }
            cumulatedOffset += childSize;
        }
        throw new Error(`Offset ${offset} is out of range.`);
    }

    resolvePageRects(from: number, to: number) {
        const rects: IPageLayoutRect[] = [];
        this.getChildren().forEach(() => {
            rects.push([]);
        });
        let offset = 0;
        this.getChildren().forEach((child, n) => {
            const childSize = child.getSize();
            const minChildOffset = 0;
            const maxChildOffset = childSize;
            const childFrom = Math.max(from - offset, minChildOffset);
            const childTo = Math.min(to - offset, maxChildOffset);
            if (childFrom <= maxChildOffset && childTo >= minChildOffset) {
                const childRects = child.resolveRects(childFrom, childTo);
                childRects.forEach(childRect => {
                    rects[n].push(childRect);
                });
            }
            offset += childSize;
        });
        return rects;
    }

    clearOwnCache() {
        this.size = undefined;
    }
}
