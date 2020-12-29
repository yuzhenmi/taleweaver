import { ILayoutNode } from './node';

export interface IVerticallyFlowingNodeChild {
    readonly layout: {
        readonly height: number;
    };
    readonly size: number;
    convertCoordinatesToPosition: (x: number, y: number) => number;
}

export function convertCoordinatesToPositionForVerticallyFlowingNode(
    x: number,
    y: number,
    paddingLeft: number,
    paddingTop: number,
    contentWidth: number,
    contentHeight: number,
    children: IVerticallyFlowingNodeChild[],
) {
    let cumulatedHeight = 0;
    let cumulatedPosition = 0;
    const contentX = Math.min(Math.max(x - paddingLeft, 0), contentWidth);
    const contentY = Math.min(Math.max(y - paddingTop, 0), contentHeight);
    for (let n = 0, nn = children.length; n < nn; n++) {
        const child = children[n];
        const childHeight = child.layout.height;
        if (contentY >= cumulatedHeight && contentY <= cumulatedHeight + childHeight) {
            const childPosition = child.convertCoordinatesToPosition(contentX, contentY - cumulatedHeight);
            return cumulatedPosition + childPosition;
        }
        cumulatedHeight += childHeight;
        cumulatedPosition += child.size;
    }
    const lastChild = children[children.length - 1];
    const lastChildPosition = lastChild.convertCoordinatesToPosition(contentX, lastChild.layout.height);
    return cumulatedPosition - lastChild.size + lastChildPosition;
}

export interface IHorizontallyFlowingNodeChild {
    readonly layout: {
        readonly width: number;
    };
    readonly size: number;
    convertCoordinatesToPosition: (x: number, y: number) => number;
}

export function convertCoordinatesToPositionForHorizontallyFlowingNode(
    x: number,
    y: number,
    paddingLeft: number,
    paddingTop: number,
    contentWidth: number,
    contentHeight: number,
    children: IHorizontallyFlowingNodeChild[],
) {
    let cumulatedWidth = 0;
    let cumulatedPosition = 0;
    const contentX = Math.min(Math.max(x - paddingLeft, 0), contentWidth);
    const contentY = Math.min(Math.max(y - paddingTop, 0), contentHeight);
    for (let n = 0, nn = children.length; n < nn; n++) {
        const child = children[n];
        const childWidth = child.layout.width;
        if (contentX >= cumulatedWidth && contentX <= cumulatedWidth + childWidth) {
            const childPosition = child.convertCoordinatesToPosition(contentX - cumulatedWidth, contentY);
            return cumulatedPosition + childPosition;
        }
        cumulatedWidth += childWidth;
        cumulatedPosition += child.size;
    }
    const lastChild = children[children.length - 1];
    const lastChildPosition = lastChild.convertCoordinatesToPosition(lastChild.layout.width, contentY);
    return cumulatedPosition - lastChild.size + lastChildPosition;
}

export type INodeWithChildren = ILayoutNode & {
    readonly children: ILayoutNode[];
};

export function describePositionForNodeWithChildren(node: INodeWithChildren, position: number) {
    if (position < 0 || position >= node.size) {
        throw new Error('Invalid position.');
    }
    let cumulatedOffset = 0;
    for (const child of node.children) {
        if (cumulatedOffset + child.size > position && cumulatedOffset <= position) {
            const childPosition = position - cumulatedOffset;
            return [{ node, position }, ...child.describePosition(childPosition)];
        }
        cumulatedOffset += child.size;
    }
    throw new Error('Error describing position.');
}
