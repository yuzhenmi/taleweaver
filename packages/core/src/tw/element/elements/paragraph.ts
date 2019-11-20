import { IElement } from 'tw/element/element';
import { BlockModelNode } from 'tw/model/block-node';
import { IAttributes } from 'tw/state/token';

export interface IParagraphAttributes extends IAttributes {}

export class ParagraphModelNode extends BlockModelNode<IParagraphAttributes> {
    getElementId() {
        return 'paragraph';
    }

    getType() {
        return '';
    }

    toHTML(from: number, to: number) {
        const $element = document.createElement('p');
        let offset = 1;
        const childNodes = this.getChildNodes();
        for (let n = 0, nn = childNodes.length; n < nn && offset < to; n++) {
            const childNode = childNodes[n];
            const childSize = childNode.getSize();
            const childFrom = Math.max(0, from - offset);
            const childTo = Math.min(childFrom + childSize, to - offset);
            offset += childSize;
            if (childFrom > childSize || childTo < 0) {
                continue;
            }
            const $childElement = childNode.toHTML(childFrom, childTo);
            $element.appendChild($childElement);
        }
        return $element;
    }
}

export const ParagraphElement: IElement = {
    buildModelNode(type: string, id: string, attributes: IAttributes) {
        return new ParagraphModelNode(id, attributes);
    },
};
