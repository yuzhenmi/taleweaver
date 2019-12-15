import { Component, IComponent } from 'tw/component/component';
import { AtomicLayoutNode } from 'tw/layout/atomic-node';
import { InlineLayoutNode } from 'tw/layout/inline-node';
import { ILayoutNode } from 'tw/layout/node';
import { ITextMeasurer } from 'tw/layout/text-measurer';
import { InlineModelNode } from 'tw/model/inline-node';
import { IAttributes, IModelNode } from 'tw/model/node';
import { AtomicRenderNode } from 'tw/render/atomic-node';
import { InlineRenderNode } from 'tw/render/inline-node';
import { IRenderNode, IStyle } from 'tw/render/node';
import { generateId } from 'tw/util/id';
import { breakTextToWords, IWord } from 'tw/util/language';
import { InlineViewNode } from 'tw/view/inline-node';

export interface ITextAttributes extends IAttributes {
    weight?: number;
    size?: number;
    font?: string;
    letterSpacing?: number;
    underline?: boolean;
    italic?: boolean;
    strikethrough?: boolean;
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
}

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

    clearOwnCache() {}

    onDidUpdate(updatedNode: this) {
        this.word = updatedNode.getWord();
        super.onDidUpdate(updatedNode);
    }
}

export class TextLayoutNode extends InlineLayoutNode {
    constructor(componentId: string, id: string, protected style: ITextStyle) {
        super(componentId, id);
    }

    getPartId() {
        return 'text';
    }

    getSize() {
        return 1;
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
        return 1;
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

    getWord() {
        return this.word;
    }

    protected takeMeasurement() {
        const measurement = this.textMeasurer.measure(this.word.text, {
            weight: 400,
            size: 16,
            font: 'sans-serif',
            letterSpacing: 0,
        });
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

    protected onLayoutDidUpdate() {
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
        this.domContainer.style.paddingTop = `${this.layoutNode.getPaddingTop()}px`;
        this.domContainer.style.paddingBottom = `${this.layoutNode.getPaddingBottom()}px`;
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
            const style = {
                weight: attributes.weight || 400,
                size: attributes.size || 14,
                font: attributes.font || 'sans-serif',
                letterSpacing: attributes.letterSpacing || 0,
                underline: !!attributes.underline,
                italic: !!attributes.italic,
                strikethrough: !!attributes.strikethrough,
            };
            const node = new TextRenderNode(this.id, modelNode.getId(), style);
            const words = breakTextToWords(modelNode.getContent());
            words.forEach((word, wordIndex) => {
                const wordRenderNode = new WordRenderNode(this.id, `${modelNode.getId()}-${wordIndex}`, style, word);
                node.appendChild(wordRenderNode);
            });
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
