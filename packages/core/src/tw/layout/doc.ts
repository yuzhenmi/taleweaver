import { ILayoutNode, ILayoutNodeType, LayoutNode } from './node';
import { IPageLayoutRect } from './rect';

export interface ILayoutDoc extends ILayoutNode {
    resolvePageRects(from: number, to: number): IPageLayoutRect[];
}

export class LayoutDoc extends LayoutNode implements ILayoutDoc {
    get type(): ILayoutNodeType {
        return 'doc';
    }

    get root() {
        return true;
    }

    get leaf() {
        return false;
    }

    get width() {
        return 0;
    }

    get height() {
        return 0;
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
                childRects.forEach((childRect) => {
                    rects[n].push(childRect);
                });
            }
            offset += childSize;
        });
        return rects;
    }
}
