import { RootModelNode } from 'tw/model/root-node';
import { IAttributes } from 'tw/state/token';
import { IElement } from '../element';

export interface IDocAttributes extends IAttributes {}

export class DocModelNode extends RootModelNode<IDocAttributes> {
    getElementId() {
        return 'doc';
    }

    getType() {
        return '';
    }

    toHTML(from: number, to: number) {
        const $element = document.createElement('div');
        let offset = 1;
        const childNodes = this.getChildNodes();
        for (let n = 0, nn = childNodes.length; n < nn && offset < to; n++) {
            const child = childNodes[n];
            const childSize = child.getSize();
            const childFrom = Math.max(0, from - offset);
            const childTo = Math.min(childFrom + childSize, to - offset);
            offset += childSize;
            if (childFrom > childSize || childTo < 0) {
                continue;
            }
            const $childElement = child.toHTML(childFrom, childTo);
            $element.appendChild($childElement);
        }
        return $element;
    }
}

export const DocElement: IElement = {
    buildModelNode(type: string, id: string, attributes: IAttributes) {
        return new DocModelNode(id, attributes);
    },
};
