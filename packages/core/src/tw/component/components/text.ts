import { Component, IComponent } from 'tw/component/component';
import { InlineLayoutNode } from 'tw/layout/inline-node';
import { InlineModelNode } from 'tw/model/inline-node';
import { IAttributes, IModelNode } from 'tw/model/node';
import { AtomicRenderNode } from 'tw/render/atomic-node';
import { InlineRenderNode } from 'tw/render/inline-node';
import { IRenderNode, IStyle } from 'tw/render/node';
import { generateId } from 'tw/util/id';
import { breakTextToWords, IWord } from 'tw/util/language';

export interface ITextAttributes extends IAttributes {
    bold?: boolean;
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
    bold: boolean;
}

export class TextRenderNode extends InlineRenderNode<ITextStyle> {
    getPartId() {
        return 'text';
    }
}

export interface IWordStyle extends IStyle {}

export class WordRenderNode extends AtomicRenderNode<IWordStyle> {
    constructor(componentId: string, id: string, style: IWordStyle, protected word: IWord) {
        super(componentId, id, style);
    }

    getPartId() {
        return 'word';
    }

    getContent() {
        return this.word.text;
    }

    isBreakable() {
        return this.word.breakable;
    }

    getModelSize() {
        return this.word.text.length;
    }

    getSize() {
        return this.word.text.length;
    }

    clearOwnCache() {}
}

export class TextLayoutNode extends InlineLayoutNode {
    getPartId() {
        return 'text';
    }

    getSize() {
        return 1;
    }
}

export class TextComponent extends Component implements IComponent {
    buildModelNode(partId: string | undefined, id: string, attributes: IAttributes) {
        return new TextModelNode(this.id, id, attributes);
    }

    buildRenderNode(modelNode: IModelNode) {
        if (modelNode instanceof TextModelNode) {
            const node = new TextRenderNode(this.id, modelNode.getId(), {
                bold: !!modelNode.getAttributes().bold,
            });
            const words = breakTextToWords(modelNode.getContent());
            const children = words.map(
                (word, wordIndex) => new WordRenderNode(this.id, `${modelNode.getId()}-${wordIndex}`, {}, word),
            );
            node.setChildren(children);
            return node;
        }
        throw new Error('Invalid text model node.');
    }

    buildLayoutNode(renderNode: IRenderNode): TextLayoutNode {
        if (renderNode instanceof TextRenderNode) {
            return new TextLayoutNode(this.id, renderNode.getId());
        }
        throw new Error('Invalid text render node.');
    }
}
