import { ILayoutNode, ILayoutNodeType, LayoutNode } from './node';
import { ILayoutRect } from './rect';

export interface ILayoutAtom extends ILayoutNode {
    readonly breakableAfter: boolean;

    breakAtWidth(width: number): ILayoutAtom;
    convertCoordinateToOffset(x: number): number;
    resolveRects(from: number, to: number): ILayoutRect[];
}

export abstract class LayoutAtom extends LayoutNode implements ILayoutAtom {
    abstract breakAtWidth(width: number): ILayoutAtom;
    abstract convertCoordinateToOffset(x: number): number;
    abstract resolveRects(from: number, to: number): ILayoutRect[];

    protected internalBreakableAfter: boolean;

    constructor(componentId: string, id: string, breakableAfter: boolean) {
        super(componentId, id, [], ' ');
        this.internalBreakableAfter = breakableAfter;
    }

    get type(): ILayoutNodeType {
        return 'atom';
    }

    get root() {
        return false;
    }

    get leaf() {
        return true;
    }

    get breakableAfter() {
        return this.internalBreakableAfter;
    }
}
