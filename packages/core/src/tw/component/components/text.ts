import { Component, IComponent } from 'tw/component/component';
import { InlineModelNode } from 'tw/model/inline-node';
import { IModelNode } from 'tw/model/node';
import { AtomicRenderNode } from 'tw/render/atomic-node';
import { InlineRenderNode } from 'tw/render/inline-node';
import { IAttributes } from 'tw/state/token';
import { generateId } from 'tw/util/id';
import { breakTextToWords, IWord } from 'tw/util/language';

export interface ITextAttributes extends IAttributes {}

export class TextModelNode extends InlineModelNode<ITextAttributes> {
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

export class TextRenderNode extends InlineRenderNode {}

export class WordRenderNode extends AtomicRenderNode {
    constructor(component: IComponent, id: string, protected word: IWord) {
        super(component, id);
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
        const node = new TextRenderNode(this, modelNode.getId());
        const words = breakTextToWords(modelNode.getContent());
        const children = words.map(
            (word, wordIndex) => new WordRenderNode(this, `${modelNode.getId()}-${wordIndex}`, word),
        );
        node.setChildren(children);
        return node;
    }
}
