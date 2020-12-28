import { ITextService } from '../text/service';
import { IInlineLayoutNode } from './inline-node';
import { BaseLayoutNode, IBaseLayoutNode, ILayoutPositionLayerDescription, IResolveBoundingBoxesResult } from './node';

export interface IWordLayoutProps {
    weight: number;
    size: number;
    family: string;
    letterSpacing: number;
    underline: boolean;
    italic: boolean;
    strikethrough: boolean;
    color: string;
}

export interface IWordLayout {
    width: number;
    height: number;
    trimmedWidth: number;
    weight: number;
    size: number;
    family: string;
    letterSpacing: number;
    underline: boolean;
    italic: boolean;
    strikethrough: boolean;
    color: string;
}

export type IWordLayoutNodeSibling = IWordLayoutNode | IInlineLayoutNode;

export interface IWordLayoutNode extends IBaseLayoutNode<IWordLayoutProps, IWordLayout> {
    readonly type: 'word';
    readonly previousSibling: IWordLayoutNodeSibling | null;
    readonly nextSibling: IWordLayoutNodeSibling | null;
    readonly previousCrossParentSibling: IWordLayoutNodeSibling | null;
    readonly nextCrossParentSibling: IWordLayoutNodeSibling | null;
    readonly content: string;
    readonly whitespaceSize: number;
    readonly trimmedSize: number;

    setPreviousSibling(previousSibling: IWordLayoutNodeSibling | null): void;
    setNextSibling(previousSibling: IWordLayoutNodeSibling | null): void;
    setPreviousCrossParentSibling(previousCrossParentSibling: IWordLayoutNodeSibling | null): void;
    setNextCrossParentSibling(previousCrossParentSibling: IWordLayoutNodeSibling | null): void;
    setContent(content: string): void;
    setWhitespaceSize(whitespaceSize: number): void;
    convertCoordinatesToPosition(x: number, y: number): number;
}

export class WordLayoutNode extends BaseLayoutNode<IWordLayoutProps, IWordLayout> implements IWordLayoutNode {
    readonly type = 'word';

    protected internalPreviousSibling: IWordLayoutNodeSibling | null = null;
    protected internalNextSibling: IWordLayoutNodeSibling | null = null;
    protected internalPreviousCrossParentSibling: IWordLayoutNodeSibling | null = null;
    protected internalNextCrossParentSibling: IWordLayoutNodeSibling | null = null;
    protected internalContent: string = '';
    protected internalWhitespaceSize: number = 0;
    protected internalWidth?: number;
    protected internalHeight?: number;
    protected internalTrimmedWidth?: number;

    constructor(protected textService: ITextService) {
        super();
        this.onDidUpdate(() => {
            this.internalWidth = undefined;
            this.internalHeight = undefined;
            this.internalTrimmedWidth = undefined;
        });
    }

    get previousSibling() {
        return this.internalPreviousSibling;
    }

    get nextSibling() {
        return this.internalNextSibling;
    }

    get previousCrossParentSibling() {
        return this.internalPreviousCrossParentSibling;
    }

    get nextCrossParentSibling() {
        return this.internalNextCrossParentSibling;
    }

    get content() {
        return this.internalContent;
    }

    get whitespaceSize() {
        return this.internalWhitespaceSize;
    }

    get trimmedSize() {
        return this.size - this.whitespaceSize;
    }

    get size() {
        return this.internalContent.length;
    }

    setPreviousSibling(previousSibling: IWordLayoutNodeSibling | null) {
        this.internalPreviousSibling = previousSibling;
    }

    setNextSibling(nextSibling: IWordLayoutNodeSibling | null) {
        this.internalNextSibling = nextSibling;
    }

    setPreviousCrossParentSibling(previousCrossParentSibling: IWordLayoutNodeSibling | null) {
        this.internalPreviousCrossParentSibling = previousCrossParentSibling;
    }

    setNextCrossParentSibling(nextCrossParentSibling: IWordLayoutNodeSibling | null) {
        this.internalNextCrossParentSibling = nextCrossParentSibling;
    }

    setContent(content: string) {
        this.internalContent = content;
        this.didUpdateEventEmitter.emit({});
    }

    setWhitespaceSize(whitespaceSize: number) {
        this.internalWhitespaceSize = whitespaceSize;
        this.didUpdateEventEmitter.emit({});
    }

    convertCoordinatesToPosition(x: number, y: number) {
        return this.searchForPosition(x, 0, this.internalContent.length, null, null) ?? this.internalContent.length - 1;
    }

    resolveBoundingBoxes(from: number, to: number): IResolveBoundingBoxesResult {
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
                        width: this.width,
                        height: this.height,
                        left: 0,
                        right: 0,
                        top: 0,
                        bottom: 0,
                    },
                ],
                children: [],
            };
        }
        if (from === to) {
            const left = this.textService.measure(this.internalContent.slice(0, from), this.textStyle).width;
            return {
                node: this,
                boundingBoxes: [
                    {
                        from,
                        to,
                        width: 0,
                        height: this.height,
                        left: left,
                        right: this.width - left,
                        top: 0,
                        bottom: 0,
                    },
                ],
                children: [],
            };
        }
        const left1 = this.textService.measure(this.internalContent.slice(0, from), this.textStyle).width;
        const left2 = this.textService.measure(this.internalContent.slice(0, to), this.textStyle).width;
        return {
            node: this,
            boundingBoxes: [
                {
                    from,
                    to,
                    width: left2 - left1,
                    height: this.height,
                    left: left1,
                    right: this.width - left2,
                    top: 0,
                    bottom: 0,
                },
            ],
            children: [],
        };
    }

    describePosition(position: number): ILayoutPositionLayerDescription[] {
        if (position < 0 || position >= this.size) {
            throw new Error('Invalid position.');
        }
        return [{ node: this, position }];
    }

    protected get width() {
        if (this.internalWidth === undefined) {
            [this.internalWidth, this.internalHeight] = this.calculateWidthAndHeight();
        }
        return this.internalWidth;
    }

    protected get height() {
        if (this.internalHeight === undefined) {
            [this.internalWidth, this.internalHeight] = this.calculateWidthAndHeight();
        }
        return this.internalHeight;
    }

    protected get trimmedWidth() {
        if (this.internalTrimmedWidth === undefined) {
            this.internalTrimmedWidth = this.calculateTrimmedWidth();
        }
        return this.internalTrimmedWidth;
    }

    protected get textStyle() {
        return {
            weight: this.layoutProps.weight,
            size: this.layoutProps.size,
            family: this.layoutProps.family,
            letterSpacing: this.layoutProps.letterSpacing,
            underline: this.layoutProps.underline,
            italic: this.layoutProps.italic,
            strikethrough: this.layoutProps.strikethrough,
            color: this.layoutProps.color,
        };
    }

    protected buildLayout() {
        return {
            width: this.width,
            height: this.height,
            trimmedWidth: this.trimmedWidth,
            weight: this.layoutProps.weight,
            size: this.layoutProps.size,
            family: this.layoutProps.family,
            letterSpacing: this.layoutProps.letterSpacing,
            underline: this.layoutProps.underline,
            italic: this.layoutProps.italic,
            strikethrough: this.layoutProps.strikethrough,
            color: this.layoutProps.color,
        };
    }

    protected calculateWidthAndHeight() {
        const measurement = this.textService.measure(this.content, this.textStyle);
        return [measurement.width, measurement.height];
    }

    protected calculateTrimmedWidth() {
        const trimmedText = this.content.substring(0, this.content.length - this.whitespaceSize);
        return this.textService.measure(trimmedText, this.textStyle).width;
    }

    protected searchForPosition(
        x: number,
        from: number,
        to: number,
        fromX: number | null,
        toX: number | null,
    ): number | null {
        if (fromX === null) {
            const measurement = this.textService.measure(this.content.substring(0, from), this.textStyle);
            fromX = measurement.width;
        }
        if (toX === null) {
            const measurement = this.textService.measure(this.content.substring(0, to), this.textStyle);
            toX = measurement.width;
        }
        if (x < fromX || x > toX) {
            return null;
        }
        if (to - from === 1) {
            return x - fromX < toX - x ? from : to;
        }
        const mid = Math.floor((from + to) / 2);
        return this.searchForPosition(x, from, mid, fromX, null) ?? this.searchForPosition(x, mid, to, null, toX);
    }
}
