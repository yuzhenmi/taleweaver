import { Component, IComponent } from 'tw/component/component';
import { RootModelNode } from 'tw/model/root-node';
import { IAttributes } from 'tw/state/token';
import { generateId } from 'tw/util/id';

export interface IDocAttributes extends IAttributes {}

export class DocModelNode extends RootModelNode<IDocAttributes> {
    getPartId() {
        return undefined;
    }

    getType() {
        return '';
    }

    toDOM(from: number, to: number) {
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
            const $childElement = child.toDOM(childFrom, childTo);
            $element.appendChild($childElement);
        }
        return $element;
    }

    clone() {
        return new DocModelNode(this.component, generateId(), this.attributes);
    }
}

export class DocComponent extends Component implements IComponent {
    buildModelNode(partId: string | undefined, id: string, attributes: IAttributes): DocModelNode {
        return new DocModelNode(this, id, attributes);
    }
}
