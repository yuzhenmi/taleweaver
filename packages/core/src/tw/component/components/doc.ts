import { IConfigService } from '../../config/service';
import { ModelRoot } from '../../model/root';
import { RenderDoc as AbstractRenderDoc } from '../../render/doc';
import { ViewDoc as AbstractViewDoc } from '../../view/doc';
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
        readonly width: number,
        readonly height: number,
        readonly paddingTop: number,
        readonly paddingBottom: number,
        readonly paddingLeft: number,
        readonly paddingRight: number,
    ) {
        super(componentId, modelId);
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

    constructor(componentId: string | null, renderId: string | null, layoutId: string) {
        super(componentId, renderId, layoutId);
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

    buildModelNode(partId: string | null, id: string, text: string, attributes: any) {
        return new ModelDoc(this.id, id, '', attributes);
    }

    buildRenderNode(partId: string | null, modelId: string) {
        switch (partId) {
            case 'doc':
                const pageConfig = this.configService.getConfig().page;
                return new RenderDoc(
                    this.id,
                    modelId,
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

    buildViewNode(partId: string | null, renderId: string, layoutId: string) {
        switch (partId) {
            case 'doc':
                return new ViewDoc(this.id, renderId, layoutId);
            default:
                throw new Error('Invalid part ID.');
        }
    }
}
