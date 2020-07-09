import { IFont, ITextService } from '../text/service';
import { generateId } from '../util/id';
import { IResolvedBoundingBoxes } from './bounding-box';
import { ILayoutNode, ILayoutNodeType, LayoutNode } from './node';

export interface ILayoutWord extends ILayoutNode {
    readonly whitespaceSize: number;
    readonly trimmedWidth: number;

    breakAt(offset: number): [ILayoutWord, ILayoutWord];
}

export class LayoutWord extends LayoutNode implements ILayoutWord {
    protected internalWidth?: number;
    protected internalHeight?: number;
    protected internalTrimmedWidth?: number;

    constructor(
        renderId: string,
        text: string,
        readonly whitespaceSize: number,
        readonly font: IFont,
        protected textService: ITextService,
    ) {
        super(generateId(), renderId, text, [], 0, 0, 0, 0);
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
            const trimmedText = this.text.substring(0, this.text.length - this.whitespaceSize);
            this.internalTrimmedWidth = this.textService.measure(trimmedText, this.font).width;
        }
        return this.internalTrimmedWidth;
    }

    convertCoordinatesToPosition(x: number, y: number) {
        let lastWidth = 0;
        const text = this.text;
        for (let n = 0, nn = text.length; n < nn; n++) {
            const measurement = this.textService.measure(text.substring(0, n), this.font);
            const width = measurement.width;
            if (width < x) {
                lastWidth = width;
                continue;
            }
            if (x - lastWidth < width - x) {
                return n - 1;
            }
            return n;
        }
        const width = this.width;
        if (x - lastWidth < width - x) {
            return text.length - 1;
        }
        return text.length;
    }

    resolveBoundingBoxes(from: number, to: number): IResolvedBoundingBoxes {
        if (from < 0 || to > this.size || from > to) {
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

    breakAt(offset: number): [ILayoutWord, ILayoutWord] {
        return [
            new LayoutWord(this.renderId!, this.text.substring(0, offset), 0, this.font, this.textService),
            new LayoutWord(
                this.renderId!,
                this.text.substring(offset),
                this.whitespaceSize,
                this.font,
                this.textService,
            ),
        ];
    }

    protected measure() {
        const measurement = this.textService.measure(this.text, this.font);
        return [measurement.width, measurement.height];
    }
}
