import { ILayoutNode, ILayoutNodeType, LayoutNode } from './node';
import { ILayoutRect } from './rect';

export interface ILayoutText extends ILayoutNode {
    readonly trimmedWidth: number;
    readonly breakableAfter: boolean;

    breakAtWidth(width: number): ILayoutText;
    convertCoordinateToOffset(x: number): number;
    resolveRects(from: number, to: number): ILayoutRect[];
}

export abstract class LayoutText extends LayoutNode implements ILayoutText {
    abstract get trimmedWidth(): number;

    abstract breakAtWidth(width: number): ILayoutText;
    abstract convertCoordinateToOffset(x: number): number;
    abstract resolveRects(from: number, to: number): ILayoutRect[];

    protected internalBreakableAfter: boolean;

    constructor(componentId: string, id: string, text: string, breakableAfter: boolean) {
        super(componentId, id, [], text);
        this.internalBreakableAfter = breakableAfter;
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

    get breakableAfter() {
        return this.internalBreakableAfter;
    }
}
