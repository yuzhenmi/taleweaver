import { LayoutDoc as AbstractDocLayoutNode } from '../../layout/doc';
import { ILayoutNode } from '../../layout/node';
import { IModelNode } from '../../model/node';
import { ModelRoot } from '../../model/root';
import { RenderDoc as AbstractRenderDoc } from '../../render/doc';
import { IRenderNode } from '../../render/node';
import { DocViewNode as AbstractDocViewNode } from '../../view/doc-node';
import { IViewNode } from '../../view/node';
import { Component, IComponent } from '../component';

export interface IDocAttributes {}

export interface IDocStyle {}

export class ModelDoc extends ModelRoot<IDocAttributes> {
    get partId() {
        return 'doc';
    }

    toDOM(from: number, to: number) {
        const $element = document.createElement('div');
        let offset = 1;
        const children = this.children;
        for (let n = 0, nn = children.length; n < nn && offset < to; n++) {
            const child = children.at(n);
            const childSize = child.size;
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
}

export class RenderDoc extends AbstractRenderDoc<IDocStyle> {
    get partId() {
        return 'doc';
    }

    get padModelSize() {
        return true;
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
        this.domContainer.style.textAlign = 'left';
        this.domContainer.style.cursor = 'text';
        this.domContainer.style.userSelect = 'none';
    }

    getDOMContainer() {
        return this.domContainer;
    }

    getDOMContentContainer() {
        return this.domContainer;
    }

    onLayoutDidUpdate() {}
}

export class DocComponent extends Component implements IComponent {
    buildModelNode(partId: string | null, id: string, attributes: {}, children: IModelNode<any>[], text: string) {
        return new ModelDoc(this.id, id, attributes, children, '');
    }

    buildRenderNode(modelNode: IModelNode<any>, children: IRenderNode<any>[]) {
        if (modelNode instanceof ModelDoc) {
            return new RenderDoc(this.id, modelNode.id, {}, children);
        }
        throw new Error('Invalid doc model node.');
    }

    buildLayoutNode(renderNode: IRenderNode<any>, children: ILayoutNode<any>[]) {
        if (renderNode instanceof RenderDoc) {
            return new DocLayoutNode(this.id, renderNode.id, children);
        }
        throw new Error('Invalid doc render node.');
    }

    buildViewNode(layoutNode: ILayoutNode, children: IViewNode<any>[]) {
        if (layoutNode instanceof DocLayoutNode) {
            return new DocViewNode(layoutNode, children);
        }
        throw new Error('Invalid layout render node.');
    }
}
