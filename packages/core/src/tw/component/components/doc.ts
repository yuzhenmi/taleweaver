import { IConfigService } from '../../config/service';
import { IModelNode } from '../../model/node';
import { ModelRoot } from '../../model/root';
import { RenderDoc as AbstractRenderDoc } from '../../render/doc';
import { IRenderNode } from '../../render/node';
import { ViewDoc as AbstractViewDoc } from '../../view/doc';
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

export class RenderDoc extends AbstractRenderDoc<IDocStyle, IDocAttributes> {
    constructor(
        componentId: string,
        modelId: string | null,
        attributes: IDocAttributes,
        children: IRenderNode<any, any>[],
        readonly width: number,
        readonly height: number,
        readonly paddingTop: number,
        readonly paddingBottom: number,
        readonly paddingLeft: number,
        readonly paddingRight: number,
    ) {
        super(componentId, modelId, attributes, children);
    }

    get partId() {
        return 'doc';
    }

    get padModelSize() {
        return true;
    }

    get style() {
        return {};
    }
}

export class ViewDoc extends AbstractViewDoc<IDocStyle> {
    readonly domContainer = document.createElement('div');

    constructor(
        componentId: string | null,
        renderId: string | null,
        layoutId: string,
        style: IDocStyle,
        children: IViewNode<any>[],
    ) {
        super(componentId, renderId, layoutId, style, children);
        this.domContainer.style.textAlign = 'left';
        this.domContainer.style.cursor = 'text';
        this.domContainer.style.userSelect = 'none';
    }

    get partId() {
        return 'doc';
    }

    get domContentContainer() {
        return this.domContainer;
    }
}

export class DocComponent extends Component implements IComponent {
    constructor(id: string, protected configService: IConfigService) {
        super(id);
    }

    buildModelNode(partId: string | null, id: string, text: string, attributes: any, children: IModelNode<any>[]) {
        return new ModelDoc(this.id, id, attributes, children);
    }

    buildRenderNode(
        partId: string | null,
        modelId: string,
        text: string,
        attributes: any,
        children: IRenderNode<any, any>[],
    ) {
        switch (partId) {
            case 'doc':
                const pageConfig = this.configService.getConfig().page;
                return new RenderDoc(
                    this.id,
                    modelId,
                    attributes,
                    children,
                    pageConfig.width,
                    pageConfig.height,
                    pageConfig.paddingTop,
                    pageConfig.paddingBottom,
                    pageConfig.paddingLeft,
                    pageConfig.paddingRight,
                );
            default:
                throw new Error('Invalid part ID.');
        }
    }

    buildViewNode(
        partId: string | null,
        renderId: string,
        layoutId: string,
        text: string,
        style: any,
        children: IViewNode<any>[],
        width: number,
        height: number,
        paddingTop: number,
        paddingBottom: number,
        paddingLeft: number,
        paddingRight: number,
    ) {
        switch (partId) {
            case 'doc':
                return new ViewDoc(this.id, renderId, layoutId, style, children);
            default:
                throw new Error('Invalid part ID.');
        }
    }
}
