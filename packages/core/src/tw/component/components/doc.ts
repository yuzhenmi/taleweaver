import { Component, IComponent } from 'tw/component/component';
import { DocLayoutNode as AbstractDocLayoutNode } from 'tw/layout/doc-node';
import { ILayoutNode } from 'tw/layout/node';
import { DocModelNode as AbstractDocModelNode } from 'tw/model/doc-node';
import { IAttributes, IModelNode } from 'tw/model/node';
import { DocRenderNode as AbstractDocRenderNode } from 'tw/render/doc-node';
import { IRenderNode, IStyle } from 'tw/render/node';
import { generateId } from 'tw/util/id';
import { DocViewNode as AbstractDocViewNode } from 'tw/view/doc-node';

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
        return new DocModelNode(this.componentId, generateId(), this.attributes);
    }
}

export interface IDocStyle extends IStyle {}

export class DocRenderNode extends AbstractDocRenderNode<IDocStyle> {
    getPartId() {
        return 'doc';
    }
}

export class DocLayoutNode extends AbstractDocLayoutNode {
    getPartId() {
        return 'doc';
    }
}

export class DocViewNode extends AbstractDocViewNode<DocLayoutNode> {
    protected domContainer: HTMLDivElement;

    constructor(layoutNode: DocLayoutNode) {
        super(layoutNode);
        this.domContainer = document.createElement('div');
    }

    getDOMContainer() {
        return this.domContainer;
    }

    getDOMContentContainer() {
        return this.domContainer;
    }
}

export class DocComponent extends Component implements IComponent {
    buildModelNode(partId: string | undefined, id: string, attributes: IAttributes) {
        return new DocModelNode(this.id, id, attributes);
    }

    buildRenderNode(modelNode: IModelNode) {
        if (modelNode instanceof DocModelNode) {
            return new DocRenderNode(this.id, modelNode.getId(), {});
        }
        throw new Error('Invalid doc model node.');
    }

    buildLayoutNode(renderNode: IRenderNode) {
        if (renderNode instanceof DocRenderNode) {
            return new DocLayoutNode(this.id, renderNode.getId());
        }
        throw new Error('Invalid doc render node.');
    }

    buildViewNode(layoutNode: ILayoutNode) {
        if (layoutNode instanceof DocLayoutNode) {
            return new DocViewNode(layoutNode);
        }
        throw new Error('Invalid layout render node.');
    }
}
