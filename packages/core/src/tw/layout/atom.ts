import { IRenderAtom } from '../render/atom';
import { ILayoutNode, ILayoutNodeType, LayoutNode } from './node';
import { ILayoutRect } from './rect';

export interface ILayoutAtom extends ILayoutNode {
    breakAtWidth(width: number): ILayoutAtom;
    convertCoordinateToOffset(x: number): number;
    resolveRects(from: number, to: number): ILayoutRect[];
}

export abstract class LayoutAtom extends LayoutNode implements ILayoutAtom {
    abstract breakAtWidth(width: number): ILayoutAtom;
    abstract convertCoordinateToOffset(x: number): number;
    abstract resolveRects(from: number, to: number): ILayoutRect[];

    constructor(protected renderNode: IRenderAtom<any>) {
        super();
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
}
