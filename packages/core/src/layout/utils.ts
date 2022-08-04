import { LayoutNode } from './nodes';

export interface VerticallyFlowingNodeChild {
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
    children: VerticallyFlowingNodeChild[],
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

export interface HorizontallyFlowingNodeChild {
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
    children: HorizontallyFlowingNodeChild[],
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

export type NodeWithChildren = LayoutNode & {
    readonly children: LayoutNode[];
};

export function describePositionForNodeWithChildren(node: NodeWithChildren, position: number) {
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

interface NodeWithCrossParentSiblings {
    firstChild?: LayoutNode | null;
    lastChild?: LayoutNode | null;
    previousCrossParentSibling: NodeWithCrossParentSiblings | null;
    nextCrossParentSibling: NodeWithCrossParentSiblings | null;

    setPreviousCrossParentSibling(crossParentPreviousSibling: NodeWithCrossParentSiblings | null): void;
    setNextCrossParentSibling(crossParentNextSibling: NodeWithCrossParentSiblings | null): void;
}

export function connectCrossParentSiblings(
    node1: NodeWithCrossParentSiblings | null,
    node2: NodeWithCrossParentSiblings | null,
) {
    if (node1) {
        if (node1.nextCrossParentSibling) {
            node1.nextCrossParentSibling.setPreviousCrossParentSibling(null);
        }
        node1.setNextCrossParentSibling(node2);
        if (node1.lastChild?.hasOwnProperty('setNextCrossParentSibling')) {
            connectCrossParentSiblings((node1.lastChild as any) || null, (node2?.firstChild as any) || null);
        }
    }
    if (node2) {
        if (node2.previousCrossParentSibling) {
            node2.previousCrossParentSibling.setNextCrossParentSibling(null);
        }
        node2.setPreviousCrossParentSibling(node1);
        if (node2.firstChild?.hasOwnProperty('setPreviousCrossParentSibling')) {
            connectCrossParentSiblings((node1?.lastChild as any) || null, (node2.firstChild as any) || null);
        }
    }
}

interface NodeWithSiblings {
    firstChild?: LayoutNode | null;
    lastChild?: LayoutNode | null;
    previousSibling: NodeWithSiblings | null;
    nextSibling: NodeWithSiblings | null;

    setPreviousSibling(previousSibling: NodeWithSiblings | null): void;
    setNextSibling(nextSibling: NodeWithSiblings | null): void;
}

export function connectSiblings(node1: NodeWithSiblings | null, node2: NodeWithSiblings | null) {
    if (node1) {
        if (node1.nextSibling) {
            node1.nextSibling.setPreviousSibling(null);
        }
        node1.setNextSibling(node2);
        if (node1.lastChild?.hasOwnProperty('setNextSibling')) {
            connectSiblings((node1.lastChild as any) || null, (node2?.firstChild as any) || null);
        }
    }
    if (node2) {
        if (node2.previousSibling) {
            node2.previousSibling.setNextSibling(null);
        }
        node2.setPreviousSibling(node1);
        if (node2.firstChild?.hasOwnProperty('setPreviousSibling')) {
            connectSiblings((node1?.lastChild as any) || null, (node2.firstChild as any) || null);
        }
    }
}
