import { AtomicLayoutNode } from '../../layout/atomic-node';
import { InlineLayoutNode } from '../../layout/inline-node';
import { ILayoutNode } from '../../layout/node';
import { InlineModelNode } from '../../model/inline-node';
import { IAttributes, IModelNode } from '../../model/node';
import { AtomicRenderNode } from '../../render/atomic-node';
import { InlineRenderNode } from '../../render/inline-node';
import { IRenderNode, IStyle } from '../../render/node';
import { generateId } from '../../util/id';
import { breakTextToWords, IWord } from '../../util/language';
import { InlineViewNode } from '../../view/inline-node';
import { Component, IComponent } from '../component';

export interface ITextAttributes extends IAttributes {
    weight?: number;
    size?: number;
    font?: string;
    letterSpacing?: number;
    underline?: boolean;
    italic?: boolean;
    strikethrough?: boolean;
    color?: string;
}

export class TextModelNode extends InlineModelNode<ITextAttributes> {
    getPartId() {
        return 'text';
    }

    toDOM(from: number, to: number) {
        const $component = document.createElement('span');
        $component.innerText = this.content.substring(from - 1, to - 1);
        return $component;
    }

    clone() {
        const node = new TextModelNode(this.componentId, generateId(), this.attributes);
        node.setContent(this.getContent());
        return node;
    }
}

export interface ITextStyle extends IStyle {
    weight: number;
    size: number;
    font: string;
    letterSpacing: number;
    underline: boolean;
    italic: boolean;
    strikethrough: boolean;
    color: string;
}

export const DEFAULT_TEXT_STYLE: ITextStyle = {
    weight: 400,
    size: 14,
    font: 'sans-serif',
    letterSpacing: 0,
    underline: false,
    italic: false,
    strikethrough: false,
    color: 'black',
};

export class TextRenderNode extends InlineRenderNode<ITextStyle> {
    getPartId() {
        return 'text';
    }
}

export interface IWordStyle extends ITextStyle {}

export class WordRenderNode extends AtomicRenderNode<IWordStyle> {
    constructor(componentId: string, id: string, style: IWordStyle, protected word: IWord) {
        super(componentId, id, style);
    }

    getPartId() {
        return 'word';
    }

    getWord() {
        return this.word;
    }

    getModelSize() {
        return this.word.text.length;
    }

    getSize() {
        return this.word.text.length;
    }

    isBreakable() {
        return this.word.breakable;
    }

    clearOwnCache() {}

    onDidUpdate(updatedNode: this) {
        super.onDidUpdate(updatedNode);
        const oldWord = this.word;
        const newWord = updatedNode.getWord();
        if (oldWord.text === newWord.text && oldWord.breakable === newWord.breakable) {
            return;
        }
        this.word = updatedNode.getWord();
        this.clearCache();
    }
}

export interface ITextMeasurement {
    width: number;
    height: number;
}

export interface ITextMeasurer {
    measure(text: string, style: ITextStyle): ITextMeasurement;
}

export class TextLayoutNode extends InlineLayoutNode {
    constructor(componentId: string, id: string, protected style: ITextStyle) {
        super(componentId, id);
    }

    getPartId() {
        return 'text';
    }

    getPaddingTop() {
        return 3;
    }

    getPaddingBottom() {
        return 6;
    }

    getPaddingLeft() {
        return 0;
    }

    getPaddingRight() {
        return 0;
    }

    getStyle() {
        return this.style;
    }

    clone() {
        return new TextLayoutNode(this.componentId, this.id, this.style);
    }
}

export class WordLayoutNode extends AtomicLayoutNode {
    protected width?: number;
    protected height?: number;
    protected tailTrimmedWidth?: number;

    constructor(
        componentId: string,
        id: string,
        protected word: IWord,
        protected style: ITextStyle,
        protected textMeasurer: ITextMeasurer,
    ) {
        super(componentId, id);
    }

    getPartId() {
        return 'word';
    }

    getSize() {
        return this.word.text.length;
    }

    getWidth() {
        if (this.width === undefined) {
            this.takeMeasurement();
        }
        return this.width!;
    }

    getHeight() {
        if (this.height === undefined) {
            this.takeMeasurement();
        }
        return this.height!;
    }

    getPaddingTop() {
        return 0;
    }

    getPaddingBottom() {
        return 0;
    }

    getPaddingLeft() {
        return 0;
    }

    getPaddingRight() {
        return 0;
    }

    getTailTrimmedWidth() {
        if (this.tailTrimmedWidth === undefined) {
            if (this.word.breakable) {
                const text = this.word.text;
                const measurement = this.textMeasurer.measure(text.substring(0, text.length - 1), this.style);
                this.tailTrimmedWidth = measurement.width;
            } else {
                this.tailTrimmedWidth = this.getWidth();
            }
        }
        return this.tailTrimmedWidth;
    }

    breakAtWidth(width: number) {
        const text = this.word.text;
        let min = 0;
        let max = text.length;
        while (max - min > 1) {
            const offset = Math.floor((max + min) / 2);
            const substr = text.substring(0, offset);
            const subwidth = this.textMeasurer.measure(substr, this.style).width;
            if (subwidth > width) {
                max = offset;
            } else {
                min = offset;
            }
        }
        const splitAt = min;
        const newWord = { ...this.word, text: text.substring(splitAt) };
        const newNode = new WordLayoutNode(this.componentId, this.id, newWord, this.style, this.textMeasurer);
        this.word.text = text.substring(0, splitAt);
        this.clearCache();
        return newNode;
    }

    getWord() {
        return this.word;
    }

    convertCoordinateToOffset(x: number) {
        let lastWidth = 0;
        const text = this.word.text;
        for (let n = 0, nn = text.length; n < nn; n++) {
            const measurement = this.textMeasurer.measure(text.substring(0, n), this.style);
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
        const width = this.getWidth();
        if (x - lastWidth < width - x) {
            return text.length - 1;
        }
        return text.length;
    }

    resolveRects(from: number, to: number) {
        if (from === 0 && to === this.getSize()) {
            return [
                {
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
                },
            ];
        }
        const fromTextMeasurement = this.textMeasurer.measure(this.word.text.substring(0, from), this.style);
        const toTextMeasurement = this.textMeasurer.measure(this.word.text.substring(0, to), this.style);
        const width = toTextMeasurement.width - fromTextMeasurement.width;
        const height = this.getHeight();
        const left = fromTextMeasurement.width;
        const right = this.getWidth() - toTextMeasurement.width;
        const top = 0;
        const bottom = 0;
        return [
            {
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
            },
        ];
    }

    onDidUpdate(updatedNode: this) {
        super.onDidUpdate(updatedNode);
        const oldWord = this.word;
        const newWord = updatedNode.getWord();
        if (oldWord.text === newWord.text && oldWord.breakable === newWord.breakable) {
            return;
        }
        this.word = updatedNode.getWord();
        this.clearCache();
    }

    clearOwnCache() {
        this.width = undefined;
        this.height = undefined;
        this.tailTrimmedWidth = undefined;
    }

    protected takeMeasurement() {
        const measurement = this.textMeasurer.measure(this.word.text, this.style);
        this.width = measurement.width;
        this.height = measurement.height;
    }
}

export class TextViewNode extends InlineViewNode<TextLayoutNode> {
    protected domContainer: HTMLSpanElement;
    protected domContent: HTMLSpanElement;

    constructor(layoutNode: TextLayoutNode) {
        super(layoutNode);
        this.domContainer = document.createElement('span');
        this.domContainer.style.display = 'inline-block';
        this.domContainer.style.whiteSpace = 'pre';
        this.domContainer.style.lineHeight = '1em';
        this.domContent = document.createElement('span');
        this.domContainer.appendChild(this.domContent);
        this.onLayoutDidUpdate();
    }

    getDOMContainer() {
        return this.domContainer;
    }

    getDOMContentContainer() {
        return this.domContainer;
    }

    onLayoutDidUpdate() {
        const text = this.layoutNode
            .getChildren()
            .map(child => {
                if (child instanceof WordLayoutNode) {
                    return child.getWord().text;
                }
                return '';
            })
            .join('');
        const style = this.layoutNode.getStyle();
        this.domContainer.style.width = `${this.layoutNode.getWidth()}px`;
        this.domContainer.style.height = `${this.layoutNode.getHeight()}px`;
        this.domContainer.style.paddingTop = `${this.layoutNode.getPaddingTop()}px`;
        this.domContainer.style.paddingBottom = `${this.layoutNode.getPaddingBottom()}px`;
        this.domContainer.style.paddingLeft = `${this.layoutNode.getPaddingLeft()}px`;
        this.domContainer.style.paddingRight = `${this.layoutNode.getPaddingRight()}px`;
        this.domContainer.style.fontFamily = style.font;
        this.domContainer.style.fontSize = `${style.size}px`;
        this.domContainer.style.letterSpacing = `${style.letterSpacing}px`;
        this.domContainer.style.fontWeight = `${style.weight}`;
        this.domContainer.style.color = style.color;
        this.domContainer.style.textDecoration = style.underline ? 'underline' : '';
        this.domContainer.style.fontStyle = style.italic ? 'italic' : '';
        this.domContent.style.textDecoration = style.strikethrough ? 'line-through' : '';
        this.domContent.innerText = text;
    }
}

export class TextComponent extends Component implements IComponent {
    constructor(id: string, protected textMeasurer: ITextMeasurer) {
        super(id);
    }

    buildModelNode(partId: string | undefined, id: string, attributes: IAttributes) {
        return new TextModelNode(this.id, id, attributes);
    }

    buildRenderNode(modelNode: IModelNode) {
        if (modelNode instanceof TextModelNode) {
            const attributes = modelNode.getAttributes();
            const style: ITextStyle = {
                ...DEFAULT_TEXT_STYLE,
                ...attributes,
            };
            const node = new TextRenderNode(this.id, modelNode.getId(), style);
            const words = breakTextToWords(modelNode.getContent());
            words.forEach((word, wordIndex) => {
                const wordRenderNode = new WordRenderNode(this.id, `${modelNode.getId()}-${wordIndex}`, style, word);
                node.appendChild(wordRenderNode);
            });
            if (words.length === 0) {
                node.appendChild(
                    new WordRenderNode(this.id, `${modelNode.getId()}-0`, style, { text: '', breakable: false }),
                );
            }
            return node;
        }
        throw new Error('Invalid text model node.');
    }

    buildLayoutNode(renderNode: IRenderNode) {
        if (renderNode instanceof TextRenderNode) {
            return new TextLayoutNode(this.id, renderNode.getId(), renderNode.getStyle());
        }
        if (renderNode instanceof WordRenderNode) {
            return new WordLayoutNode(
                this.id,
                renderNode.getId(),
                renderNode.getWord(),
                renderNode.getStyle(),
                this.textMeasurer,
            );
        }
        throw new Error('Invalid text render node.');
    }

    buildViewNode(layoutNode: ILayoutNode) {
        if (layoutNode instanceof TextLayoutNode) {
            return new TextViewNode(layoutNode);
        }
        throw new Error('Invalid text layout node');
    }
}

export class TextMeasurer implements ITextMeasurer {
    protected $canvas: HTMLCanvasElement;

    constructor() {
        this.$canvas = document.createElement('canvas');
    }

    measure(text: string, textStyle: ITextStyle) {
        const ctx = this.$canvas.getContext('2d')!;
        const weight = textStyle.weight;
        const size = textStyle.size;
        const font = this.fixFont(textStyle.font);
        const letterSpacing = textStyle.letterSpacing!;
        ctx.font = `${weight} ${size}px ${font}`;
        const measurement = ctx.measureText(text);
        const width =
            letterSpacing === 0 || text.length <= 1
                ? measurement.width
                : measurement.width + (text.length - 1) * letterSpacing;
        return {
            width,
            height: size,
        };
    }

    protected fixFont(font: string) {
        if (font.indexOf(' ') >= 0) {
            return `'${font}'`;
        }
        return font;
    }
}
