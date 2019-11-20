import { IElement } from 'tw/element/element';
import { InlineModelNode } from 'tw/model/inline-node';
import { IAttributes } from 'tw/state/token';

export interface ITextAttributes extends IAttributes {}

export class TextModelNode extends InlineModelNode<ITextAttributes> {
    getElementId() {
        return 'text';
    }

    getType() {
        return '';
    }

    toHTML(from: number, to: number) {
        const $element = document.createElement('span');
        $element.innerText = this.content.substring(from - 1, to - 1);
        return $element;
    }
}

export const TextElement: IElement = {
    buildModelNode(type: string, id: string, attributes: IAttributes) {
        return new TextModelNode(id, attributes);
    },
};
