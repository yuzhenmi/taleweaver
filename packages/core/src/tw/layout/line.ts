import { generateId } from '../util/id';
import { IResolvedBoundingBoxes } from './bounding-box';
import { ILayoutNode, ILayoutNodeType, LayoutNode } from './node';
import { ILayoutWord } from './word';

export interface ILayoutLine extends ILayoutNode {
    readonly contentWidth: number;
}

export class LayoutLine extends LayoutNode implements ILayoutLine {
    protected internalHeight?: number;
    protected internalContentWidth?: number;

    constructor(children: ILayoutNode[], readonly width: number) {
        super(generateId(), null, '', children, 0, 8, 0, 0);
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
            this.internalHeight =
                this.children.reduce((height, child) => Math.max(height, child.height), 0) + this.paddingVertical;
        }
        return this.internalHeight;
    }

    get contentWidth() {
        if (this.internalContentWidth === undefined) {
            this.internalContentWidth = this.children.reduce((contentWidth, child) => contentWidth + child.width, 0);
        }
        return this.internalContentWidth;
    }

    convertCoordinatesToPosition(x: number, y: number) {
        let offset = 0;
        let cumulatedWidth = 0;
        for (let n = 0, nn = this.children.length; n < nn; n++) {
            const child = this.children.at(n);
            const childWidth = child.width;
            if (x >= cumulatedWidth && x <= cumulatedWidth + childWidth) {
                offset += child.convertCoordinatesToPosition(x - cumulatedWidth, 0);
                break;
            }
            offset += child.size;
            cumulatedWidth += childWidth;
        }
        if (offset === this.size) {
            const lastChild = this.lastChild;
            if (lastChild && lastChild.type === 'text') {
                const lastWord = lastChild.lastChild as ILayoutWord | undefined;
                if (lastWord && lastWord.whitespaceSize > 0) {
                    offset--;
                }
            }
        }
        return offset;
    }

    resolveBoundingBoxes(from: number, to: number): IResolvedBoundingBoxes {
        if (from < 0 || to > this.size || from > to) {
            throw new Error('Invalid range.');
        }
        const resolvedChildren: IResolvedBoundingBoxes[] = [];
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
                const resolvedChild = child.resolveBoundingBoxes(childFrom, childTo);
                resolvedChildren.push(resolvedChild);
                if (left1 === null) {
                    left1 = left2 + resolvedChild.boundingBoxes[0].left;
                }
                left2 += resolvedChild.boundingBoxes
                    .slice(0, resolvedChild.boundingBoxes.length - 1)
                    .reduce((width, box) => width + box.left + box.width + box.right, 0);
                left2 += resolvedChild.boundingBoxes[0].left + resolvedChild.boundingBoxes[0].width;
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
                    height: from === to ? this.innerHeight : this.height,
                    left: this.paddingLeft + left1!,
                    right: this.width - this.paddingLeft - left2!,
                    top: from === to ? this.paddingTop : 0,
                    bottom: from === to ? this.paddingBottom : 0,
                },
            ],
            children: resolvedChildren,
        };
    }
}
