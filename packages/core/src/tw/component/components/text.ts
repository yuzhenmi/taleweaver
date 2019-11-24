import { Component, IComponent } from 'tw/component/component';
import { InlineModelNode } from 'tw/model/inline-node';
import { IAttributes, IModelNode } from 'tw/model/node';
import { AtomicRenderNode } from 'tw/render/atomic-node';
import { InlineRenderNode } from 'tw/render/inline-node';
import { IStyle } from 'tw/render/node';
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
        const node = new TextModelNode(this.component, generateId(), this.attributes);
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
    constructor(component: IComponent, id: string, style: IWordStyle, protected word: IWord) {
        super(component, id, style);
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
}

export class TextComponent extends Component implements IComponent {
    buildModelNode(partId: string | undefined, id: string, attributes: IAttributes): TextModelNode {
        return new TextModelNode(this, id, attributes);
    }

    buildRenderNode(modelNode: IModelNode): TextRenderNode {
        if (!(modelNode instanceof TextModelNode)) {
            throw new Error('Invalid text model node.');
        }
        const node = new TextRenderNode(this, modelNode.getId(), {
            bold: !!modelNode.getAttributes().bold,
        });
        const words = breakTextToWords(modelNode.getContent());
        const children = words.map(
            (word, wordIndex) => new WordRenderNode(this, `${modelNode.getId()}-${wordIndex}`, {}, word),
        );
        node.setChildren(children);
        return node;
    }
}
