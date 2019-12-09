import { Component, IComponent } from 'tw/component/component';
import { AtomicLayoutNode } from 'tw/layout/atomic-node';
import { InlineLayoutNode } from 'tw/layout/inline-node';
import { ITextMeasurer } from 'tw/layout/text-measurer';
import { InlineModelNode } from 'tw/model/inline-node';
import { IAttributes, IModelNode } from 'tw/model/node';
import { AtomicRenderNode } from 'tw/render/atomic-node';
import { InlineRenderNode } from 'tw/render/inline-node';
import { IRenderNode, IStyle } from 'tw/render/node';
import { generateId } from 'tw/util/id';
import { breakTextToWords, IWord } from 'tw/util/language';

export interface ITextAttributes extends IAttributes {
    weight?: number;
    size?: number;
    font?: string;
    letterSpacing?: number;
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

    onUpdated(updatedNode: this) {
        this.word = updatedNode.getWord();
        super.onUpdated(updatedNode);
    }
}

export class TextLayoutNode extends InlineLayoutNode {
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

    clone() {
        return new TextLayoutNode(this.componentId, this.id);
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

export class TextComponent extends Component implements IComponent {
    constructor(id: string, protected textMeasurer: ITextMeasurer) {
        super(id);
    }

    buildModelNode(partId: string | undefined, id: string, attributes: IAttributes) {
        return new TextModelNode(this.id, id, attributes);
    }

    buildRenderNode(modelNode: IModelNode) {
        if (modelNode instanceof TextModelNode) {
            const style = {
                weight: modelNode.getAttributes().weight || 400,
                size: modelNode.getAttributes().size || 14,
                font: modelNode.getAttributes().font || 'sans-serif',
                letterSpacing: modelNode.getAttributes().letterSpacing || 0,
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
            return new TextLayoutNode(this.id, renderNode.getId());
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
}
