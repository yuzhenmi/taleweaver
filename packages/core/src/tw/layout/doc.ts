import { ILayoutNode, ILayoutNodeType, IResolveBoundingBoxesResult, LayoutNode } from './node';

export interface ILayoutDoc extends ILayoutNode {}

export class LayoutDoc extends LayoutNode implements ILayoutDoc {
    constructor(
        renderId: string | null,
        children: ILayoutNode[],
        readonly width: number,
        readonly height: number,
        paddingTop: number,
        paddingBottom: number,
        paddingLeft: number,
        paddingRight: number,
    ) {
        super(renderId, '', children, paddingTop, paddingBottom, paddingLeft, paddingRight);
    }

    get type(): ILayoutNodeType {
        return 'doc';
    }

    get root() {
        return true;
    }

    get leaf() {
        return false;
    }

    convertCoordinatesToOffset(x: number, y: number): number {
        throw new Error('Use page to convert coordinates to offset.');
    }

    resolveBoundingBoxes(from: number, to: number): IResolveBoundingBoxesResult {
        if (from < 0 || to >= this.size || from > to) {
            throw new Error('Invalid range.');
        }
        const childResults: IResolveBoundingBoxesResult[] = [];
        let cumulatedOffset = 0;
        this.children.forEach((child) => {
            if (cumulatedOffset + child.size > from && cumulatedOffset < to) {
                const childFrom = Math.max(0, from - cumulatedOffset);
                const childTo = Math.min(child.size, to - cumulatedOffset);
                const childResult = child.resolveBoundingBoxes(childFrom, childTo);
                childResults.push(childResult);
            }
            cumulatedOffset += child.size;
        });
        return {
            node: this,
            boundingBoxes: [],
            children: childResults,
        };
    }
}
