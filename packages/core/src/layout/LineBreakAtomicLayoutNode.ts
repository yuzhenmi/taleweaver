import { DEFAULT_STYLE } from '../config/TextConfig';
import AtomicNode from './AtomicLayoutNode';
import TextWordLayoutNode from './TextWordLayoutNode';
import measureText from './utils/measureText';

export default class LineBreakAtomicLayoutNode extends AtomicNode {
    protected width?: number;
    protected height?: number;

    getType() {
        return 'LineBreakAtomic';
    }

    getSize() {
        return 1;
    }

    getBreakable() {
        return true;
    }

    getWidth() {
        if (this.width === undefined || this.height === undefined) {
            this.updateBoundingBox();
        }
        return this.width!;
    }

    getWidthWithoutTrailingWhitespace() {
        return 0;
    }

    getHeight() {
        if (this.width === undefined || this.height === undefined) {
            this.updateBoundingBox();
        }
        return this.height!;
    }

    clearCache() {
        this.width = undefined;
        this.height = undefined;
    }

    splitAtWidth(width: number): LineBreakAtomicLayoutNode {
        throw new Error('Cannot split line break atomic box.');
    }

    join(node: LineBreakAtomicLayoutNode) {
        throw new Error('Cannot join line break atomic boxes.');
    }

    convertCoordinatesToOffset(x: number) {
        return 0;
    }

    resolveLayoutRects(from: number, to: number) {
        if (from === to) {
            return [{
                left: 0,
                right: this.getWidth(),
                top: 0,
                bottom: 0,
                width: 0,
                height: this.getHeight(),
                paddingTop: 0,
                paddingBottom: 0,
                paddingLeft: 0,
                paddingRight: 0,
            }];
        }
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

    protected updateBoundingBox() {
        const previousSibling = this.getPreviousSibling();
        let textStyle = DEFAULT_STYLE;
        if (previousSibling) {
            if (previousSibling instanceof TextWordLayoutNode) {
                textStyle = previousSibling.getTextStyle();
            }
            const measurement = measureText(' ', textStyle);
            this.width = measurement.width;
            this.height = (previousSibling as AtomicNode).getHeight();
        } else {
            const measurement = measureText(' ', textStyle);
            this.width = measurement.width;
            this.height = measurement.height;
        }
    }
}
