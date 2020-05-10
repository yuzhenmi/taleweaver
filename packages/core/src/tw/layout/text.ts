import { IFont } from '../render/font';
import { ILayoutNode, ILayoutNodeType, LayoutNode } from './node';
import { ILayoutRect } from './rect';
import { ITextMeasurer } from './text-measurer';

export interface ILayoutText extends ILayoutNode {
    readonly trimmedWidth: number;

    breakAtWidth(width: number): ILayoutText;
    convertCoordinateToOffset(x: number): number;
    resolveRects(from: number, to: number): ILayoutRect[];
}

export class LayoutText extends LayoutNode implements ILayoutText {
    abstract breakAtWidth(width: number): ILayoutText;
    abstract convertCoordinateToOffset(x: number): number;
    abstract resolveRects(from: number, to: number): ILayoutRect[];

    protected internalWidth?: number;
    protected internalHeight?: number;
    protected internalTrimmedWidth?: number;

    constructor(
        renderId: string | null,
        text: string,
        readonly fontConfig: IFont,
        protected textMeasurer: ITextMeasurer,
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

    get width() {
        if (this.internalWidth === undefined) {
            [this.internalWidth, this.internalHeight] = this.measure();
        }
        return this.internalWidth;
    }

    get height() {
        if (this.internalHeight === undefined) {
            [this.internalWidth, this.internalHeight] = this.measure();
        }
        return this.internalHeight;
    }

    get trimmedWidth() {
        if (this.internalTrimmedWidth === undefined) {
            this.internalTrimmedWidth = this.textMeasurer.measureTrimmed(this.text, this.fontConfig).width;
        }
        return this.internalTrimmedWidth;
    }

    protected get trimmable() {
        return false;
    }

    protected measure(): [number, number] {
        const measurement = this.textMeasurer.measure(this.text, this.fontConfig);
        return [measurement.width, measurement.height];
    }
}
