import { Component, IComponent } from 'tw/component/component';
import { DocModelNode as AbstractDocModelNode } from 'tw/model/doc-node';
import { IAttributes, IModelNode } from 'tw/model/node';
import { DocRenderNode as AbstractDocRenderNode } from 'tw/render/doc-node';
import { IStyle } from 'tw/render/node';
import { generateId } from 'tw/util/id';

export interface IDocAttributes extends IAttributes {}

export class DocModelNode extends AbstractDocModelNode<IDocAttributes> {
    getPartId() {
        return 'doc';
    }

    toDOM(from: number, to: number) {
        const $element = document.createElement('div');
        let offset = 1;
        const children = this.getChildren();
        for (let n = 0, nn = children.length; n < nn && offset < to; n++) {
            const child = children[n];
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

export interface IDocStyle extends IStyle {}

export class DocRenderNode extends AbstractDocRenderNode<IDocStyle> {
    getPartId() {
        return 'doc';
    }
}

export class DocComponent extends Component implements IComponent {
    buildModelNode(partId: string | undefined, id: string, attributes: IAttributes): DocModelNode {
        return new DocModelNode(this, id, attributes);
    }

    buildRenderNode(modelNode: IModelNode): DocRenderNode {
        if (!(modelNode instanceof DocModelNode)) {
            throw new Error('Invalid doc model node.');
        }
        return new DocRenderNode(this, modelNode.getId(), {});
    }
}
