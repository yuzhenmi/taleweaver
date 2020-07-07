import { IDOMService } from '../../dom/service';
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

    get pseudo() {
        return false;
    }

    get style() {
        return {};
    }
}

export class ViewDoc extends AbstractViewDoc<IDocStyle> {
    constructor(
        domContainer: HTMLElement,
        componentId: string | null,
        renderId: string | null,
        layoutId: string,
        style: IDocStyle,
        children: IViewNode<any>[],
        domService: IDOMService,
    ) {
        super(domContainer, componentId, renderId, layoutId, style, children, domService);
        this.domContainer.style.textAlign = 'left';
        this.domContainer.style.cursor = 'text';
        this.domContainer.style.userSelect = 'none';
        this.domContainer.innerHTML = '';
        const domContentContainer = domService.createElement('div');
        domContentContainer.setAttribute('data-tw-role', 'content-container');
        children.map((child) => domContentContainer.appendChild(child.domContainer));
        this.domContainer.appendChild(domContentContainer);
    }

    get partId() {
        return 'doc';
    }
}

export class DocComponent extends Component implements IComponent {
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
        const configService = this.serviceRegistry.getService('config');
        switch (partId) {
            case 'doc':
                const pageConfig = configService.getConfig().page;
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
        domContainer: HTMLElement,
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
        const domService = this.serviceRegistry.getService('dom');
        switch (partId) {
            case 'doc':
                return new ViewDoc(domContainer, this.id, renderId, layoutId, style, children, domService);
            default:
                throw new Error('Invalid part ID.');
        }
    }

    toDOM(partId: string | null, attributes: {}, text: string, children: HTMLElement[]) {
        switch (partId) {
            case 'doc': {
                const $element = document.createElement('div');
                children.forEach((child) => $element.appendChild(child));
                return $element;
            }
            default:
                throw new Error('Invalid part ID.');
        }
    }
}
