import { Component, IComponent } from 'tw/component/component';
import { BlockModelNode } from 'tw/model/block-node';
import { IModelNode } from 'tw/model/node';
import { BlockRenderNode } from 'tw/render/block-node';
import { IAttributes } from 'tw/state/token';
import { generateId } from 'tw/util/id';

export interface IParagraphAttributes extends IAttributes {}

export class ParagraphModelNode extends BlockModelNode<IParagraphAttributes> {
    toDOM(from: number, to: number) {
        const $element = document.createElement('p');
        let offset = 1;
        const children = this.getChildren();
        for (let n = 0, nn = children.length; n < nn && offset < to; n++) {
            const childNode = children[n];
            const childSize = childNode.getSize();
            const childFrom = Math.max(0, from - offset);
            const childTo = Math.min(childFrom + childSize, to - offset);
            offset += childSize;
            if (childFrom > childSize || childTo < 0) {
                continue;
            }
            const $childElement = childNode.toDOM(childFrom, childTo);
            $element.appendChild($childElement);
        }
        return $element;
    }

    clone() {
        return new ParagraphModelNode(this.component, generateId(), this.attributes);
    }
}

export class ParagraphRenderNode extends BlockRenderNode {}

export class ParagraphComponent extends Component implements IComponent {
    buildModelNode(partId: string | undefined, id: string, attributes: IAttributes): ParagraphModelNode {
        return new ParagraphModelNode(this, id, attributes);
    }

    buildRenderNode(modelNode: IModelNode): ParagraphRenderNode {
        if (!(modelNode instanceof ParagraphModelNode)) {
            throw new Error('Invalid paragraph model node.');
        }
        return new ParagraphRenderNode(this, modelNode.getId());
    }
}
