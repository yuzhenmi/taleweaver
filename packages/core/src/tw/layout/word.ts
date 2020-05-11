import { ILayoutNode, ILayoutNodeType, LayoutNode } from './node';
import { ILayoutRect } from './rect';

export interface ILayoutWord extends ILayoutNode {
    readonly trimmedWidth: number;

    convertCoordinateToOffset(x: number): number;
    resolveRects(from: number, to: number): ILayoutRect[];
}

export class LayoutWord extends LayoutNode implements ILayoutWord {
    abstract convertCoordinateToOffset(x: number): number;
    abstract resolveRects(from: number, to: number): ILayoutRect[];

    constructor(
        renderId: string | null,
        text: string,
        readonly width: number,
        readonly height: number,
        readonly trimmedWidth: number,
    ) {
        super(renderId, text, 0, 0, 0, 0);
    }

    get type(): ILayoutNodeType {
        return 'text';
    }

    get root() {
        return false;
    }

    get leaf() {
        return true;
    }
}
