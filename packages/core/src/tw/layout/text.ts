import { IRenderText } from '../render/text';
import { ILayoutNode, ILayoutNodeType, LayoutNode } from './node';
import { ILayoutRect } from './rect';

export interface ILayoutText extends ILayoutNode {
    readonly trimmedWidth: number;

    breakAtWidth(width: number): ILayoutText;
    convertCoordinateToOffset(x: number): number;
    resolveRects(from: number, to: number): ILayoutRect[];
}

export abstract class LayoutText extends LayoutNode implements ILayoutText {
    abstract get trimmedWidth(): number;

    abstract breakAtWidth(width: number): ILayoutText;
    abstract convertCoordinateToOffset(x: number): number;
    abstract resolveRects(from: number, to: number): ILayoutRect[];

    constructor(protected renderNode: IRenderText<any>) {
        super();
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
