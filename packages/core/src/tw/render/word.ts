import { generateId } from '../util/id';
import { IFont } from './font';
import { IRenderNode, IRenderNodeType, RenderNode } from './node';
import { ITextMeasurer } from './text-measurer';

export interface IRenderWord<TStyle> extends IRenderNode<TStyle> {
    readonly width: number;
    readonly height: number;
    readonly trimmedWidth: number;
}

export abstract class RenderWord extends RenderNode<IFont> implements IRenderWord<IFont> {
    protected internalWidth?: number;
    protected internalHeight?: number;
    protected internalTrimmedWidth?: number;

    constructor(componentId: string, protected textMeasurer: ITextMeasurer) {
        super(componentId, null, generateId());
        this.onDidUpdateNode(() => {
            this.internalWidth = undefined;
            this.internalHeight = undefined;
            this.internalTrimmedWidth = undefined;
        });
    }

    get type(): IRenderNodeType {
        return 'word';
    }

    get root() {
        return false;
    }

    get leaf() {
        return true;
    }

    get padModelSize() {
        return false;
    }

    get modelTextSize() {
        return 0;
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
            this.internalTrimmedWidth = this.textMeasurer.measureTrimmed(this.text, this.style).width;
        }
        return this.internalTrimmedWidth;
    }

    protected measure() {
        const measurement = this.textMeasurer.measure(this.text, this.style);
        return [measurement.width, measurement.height];
    }
}
