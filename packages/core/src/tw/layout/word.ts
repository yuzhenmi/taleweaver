import { IFont } from '../render/font';
import { ILayoutNode, ILayoutNodeType, IResolveBoundingBoxesResult, LayoutNode } from './node';
import { ITextService } from './text-service';

export interface ILayoutWord extends ILayoutNode {
    readonly trimmedWidth: number;
}

export class LayoutWord extends LayoutNode implements ILayoutWord {
    protected internalWidth?: number;
    protected internalHeight?: number;
    protected internalTrimmedWidth?: number;

    constructor(renderId: string | null, text: string, readonly font: IFont, protected textService: ITextService) {
        super(renderId, text, 0, 0, 0, 0);
    }

    get type(): ILayoutNodeType {
        return 'word';
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
            const trimmedText = this.textService.trim(this.text);
            this.internalTrimmedWidth = this.textService.measure(trimmedText, this.font).width;
        }
        return this.internalTrimmedWidth;
    }

    resolveBoundingBoxes(from: number, to: number): IResolveBoundingBoxesResult {
        if (from < 0 || to >= this.size || from > to) {
            throw new Error('Invalid range.');
        }
        if (from === 0 && to === this.size) {
            return {
                node: this,
                boundingBoxes: [
                    {
                        from,
                        to,
                        width: this.innerWidth,
                        height: this.innerHeight,
                        left: this.paddingLeft,
                        right: this.paddingRight,
                        top: this.paddingTop,
                        bottom: this.paddingBottom,
                    },
                ],
                children: [],
            };
        }
        if (from === to) {
            const left = this.textService.measure(this.text.slice(0, from), this.font).width;
            return {
                node: this,
                boundingBoxes: [
                    {
                        from,
                        to,
                        width: 0,
                        height: this.innerHeight,
                        left: this.paddingLeft + left,
                        right: this.width - this.paddingLeft - left,
                        top: this.paddingTop,
                        bottom: this.paddingBottom,
                    },
                ],
                children: [],
            };
        }
        const left1 = this.textService.measure(this.text.slice(0, from), this.font).width;
        const left2 = this.textService.measure(this.text.slice(0, to), this.font).width;
        return {
            node: this,
            boundingBoxes: [
                {
                    from,
                    to,
                    width: left2 - left1,
                    height: this.innerHeight,
                    left: this.paddingLeft + left1,
                    right: this.innerWidth - this.paddingLeft - left2,
                    top: this.paddingTop,
                    bottom: this.paddingBottom,
                },
            ],
            children: [],
        };
    }

    protected measure() {
        const measurement = this.textService.measure(this.text, this.font);
        return [measurement.width, measurement.height];
    }
}
