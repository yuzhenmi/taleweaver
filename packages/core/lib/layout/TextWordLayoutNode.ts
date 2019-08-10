import Editor from '../Editor';
import TextWordRenderNode from '../render/TextWordRenderNode';
import AtomicNode from './AtomicLayoutNode';
import measureText from './utils/measureText';

export default class TextWordLayoutNode extends AtomicNode {
    protected renderNode: TextWordRenderNode;
    protected content: string;
    protected width?: number;
    protected widthWithoutTrailingWhitespace?: number;
    protected height?: number;

    constructor(editor: Editor, renderNode: TextWordRenderNode, content?: string) {
        super(editor, renderNode.getID());
        this.renderNode = renderNode;
        this.content = content || renderNode.getContent();
    }

    getType() {
        return 'TextWord';
    }

    getSize() {
        return this.content.length;
    }

    getWidth() {
        if (this.width === undefined || this.height === undefined) {
            this.takeMeasurement();
        }
        return this.width!;
    }

    getWidthWithoutTrailingWhitespace() {
        if (this.widthWithoutTrailingWhitespace === undefined) {
            if (this.renderNode.getBreakable()) {
                const content = this.content;
                const measurement = measureText(content.substring(0, content.length - 1), this.getTextStyle());
                this.widthWithoutTrailingWhitespace = measurement.width;
            } else {
                this.widthWithoutTrailingWhitespace = this.getWidth();
            }
        }
        return this.widthWithoutTrailingWhitespace;
    }

    getHeight() {
        if (this.width === undefined || this.height === undefined) {
            this.takeMeasurement();
        }
        return this.height!;
    }

    getBreakable() {
        return this.renderNode.getBreakable();
    }

    getContent() {
        return this.content;
    }

    getTextStyle() {
        return this.renderNode.getTextStyle();
    }

    clearCache() {
        this.width = undefined;
        this.widthWithoutTrailingWhitespace = undefined;
        this.height = undefined;
    }

    onUpdated(updatedNode: this) {
        super.onUpdated(updatedNode);
        this.content = updatedNode.getContent();
    }

    splitAtWidth(width: number) {
        let min = 0;
        let max = this.content.length;
        while (max - min > 1) {
            const offset = Math.floor((max + min) / 2);
            const substr = this.content.substring(0, offset);
            const subwidth = measureText(substr, this.getTextStyle()).width;
            if (subwidth > width) {
                max = offset;
            } else {
                min = offset;
            }
        }
        const splitAt = min;
        const newNode = new TextWordLayoutNode(this.editor, this.renderNode, this.content.substring(splitAt));
        this.content = this.content.substring(0, splitAt);
        this.clearCache();
        return newNode;
    }

    join(node: TextWordLayoutNode) {
        this.content += node.getContent();
        this.clearCache();
    }

    convertCoordinatesToOffset(x: number) {
        let lastWidth = 0;
        for (let n = 0, nn = this.content.length; n < nn; n++) {
            const textMeasurement = measureText(this.content.substring(0, n), this.getTextStyle());
            const width = textMeasurement.width;
            if (width < x) {
                lastWidth = width;
                continue;
            }
            if (x - lastWidth < width - x) {
                return n - 1;
            }
            return n;
        }
        const width = this.getWidth();
        if (x - lastWidth < width - x) {
            return this.content.length - 1;
        }
        return this.content.length;
    }

    resolveRects(from: number, to: number) {
        if (from === 0 && to === this.getSize()) {
            return [{
                left: 0,
                right: 0,
                top: 0,
                bottom: 0,
                width: this.getWidth(),
                height: this.getHeight(),
                paddingTop: 0,
                paddingBottom: 0,
                paddingLeft: 0,
                paddingRight: 0,
            }];
        }
        const fromTextMeasurement = measureText(this.content.substring(0, from), this.getTextStyle());
        const toTextMeasurement = measureText(this.content.substring(0, to), this.getTextStyle());
        const width = toTextMeasurement.width - fromTextMeasurement.width;
        const height = this.getHeight();
        const left = fromTextMeasurement.width;
        const right = this.getWidth() - toTextMeasurement.width;
        const top = 0;
        const bottom = 0;
        return [{
            width,
            height,
            left,
            right,
            top,
            bottom,
            paddingTop: 0,
            paddingBottom: 0,
            paddingLeft: 0,
            paddingRight: 0,
        }];
    }

    protected takeMeasurement() {
        const measurement = measureText(this.content, this.getTextStyle());
        this.width = measurement.width;
        this.height = measurement.height;
    }
}
