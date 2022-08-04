import { TextService } from '../../text/service';
import { BaseLayoutNode, LayoutPositionLayerDescription, ResolveBoundingBoxesResult } from './base';
import { InlineLayoutNode } from './inline';

export interface WordLayoutProps {
    weight: number;
    size: number;
    family: string;
    letterSpacing: number;
    underline: boolean;
    italic: boolean;
    strikethrough: boolean;
    color: string;
}

export interface WordLayout {
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

export type WordLayoutNodeSibling = WordLayoutNode | InlineLayoutNode;

export class WordLayoutNode extends BaseLayoutNode<WordLayoutProps, WordLayout> {
    readonly type = 'word';

    protected internalPreviousSibling: WordLayoutNodeSibling | null = null;
    protected internalNextSibling: WordLayoutNodeSibling | null = null;
    protected internalPreviousCrossParentSibling: WordLayoutNodeSibling | null = null;
    protected internalNextCrossParentSibling: WordLayoutNodeSibling | null = null;
    protected internalContent: string = '';
    protected internalWhitespaceSize: number = 0;
    protected internalWidth?: number;
    protected internalHeight?: number;
    protected internalTrimmedWidth?: number;

    constructor(protected textService: TextService) {
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

    setPreviousSibling(previousSibling: WordLayoutNodeSibling | null) {
        this.internalPreviousSibling = previousSibling;
    }

    setNextSibling(nextSibling: WordLayoutNodeSibling | null) {
        this.internalNextSibling = nextSibling;
    }

    setPreviousCrossParentSibling(previousCrossParentSibling: WordLayoutNodeSibling | null) {
        this.internalPreviousCrossParentSibling = previousCrossParentSibling;
    }

    setNextCrossParentSibling(nextCrossParentSibling: WordLayoutNodeSibling | null) {
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

    resolveBoundingBoxes(from: number, to: number): ResolveBoundingBoxesResult {
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

    describePosition(position: number): LayoutPositionLayerDescription[] {
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
        const content = this.content.replace(/\n$/, '');
        if (fromX === null) {
            const measurement = this.textService.measure(content.substring(0, from), this.textStyle);
            fromX = measurement.width;
        }
        if (toX === null) {
            const measurement = this.textService.measure(content.substring(0, to), this.textStyle);
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
