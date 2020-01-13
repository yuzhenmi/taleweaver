import { IConfigService } from '../../config/service';
import { ILayoutNode } from '../../layout/node';
import { PageLayoutNode as AbstractPageLayoutNode } from '../../layout/page-node';
import { IAttributes, IModelNode } from '../../model/node';
import { IRenderNode } from '../../render/node';
import { PageViewNode as AbstractPageViewNode } from '../../view/page-node';
import { Component } from '../component';
import { IPageComponent } from '../page-component';

export class PageLayoutNode extends AbstractPageLayoutNode {
    getPartId() {
        return 'page';
    }

    clone() {
        return new PageLayoutNode(
            this.getComponentId(),
            this.width,
            this.height,
            this.paddingTop,
            this.paddingBottom,
            this.paddingLeft,
            this.paddingRight,
        );
    }
}

export class PageViewNode extends AbstractPageViewNode<PageLayoutNode> {
    protected domContainer: HTMLDivElement;
    protected domContentContainer: HTMLDivElement;

    constructor(layoutNode: PageLayoutNode) {
        super(layoutNode);
        this.domContainer = document.createElement('div');
        this.domContainer.style.position = 'relative';
        this.domContainer.style.marginLeft = 'auto';
        this.domContainer.style.marginRight = 'auto';
        this.domContentContainer = document.createElement('div');
        this.domContainer.appendChild(this.domContentContainer);
    }

    getDOMContainer() {
        return this.domContainer;
    }

    getDOMContentContainer() {
        return this.domContentContainer;
    }

    onLayoutDidUpdate() {
        this.domContainer.style.width = `${this.layoutNode.getWidth()}px`;
        this.domContainer.style.height = `${this.layoutNode.getHeight()}px`;
        this.domContainer.style.paddingTop = `${this.layoutNode.getPaddingTop()}px`;
        this.domContainer.style.paddingBottom = `${this.layoutNode.getPaddingBottom()}px`;
        this.domContainer.style.paddingLeft = `${this.layoutNode.getPaddingLeft()}px`;
        this.domContainer.style.paddingRight = `${this.layoutNode.getPaddingRight()}px`;
    }
}

export class PageComponent extends Component implements IPageComponent {
    constructor(id: string, protected configService: IConfigService) {
        super(id);
    }

    buildModelNode(partId: string | undefined, id: string, attributes: IAttributes): IModelNode {
        throw new Error('Page component does not support buildModelNode.');
    }

    buildRenderNode(modelNode: IModelNode): IRenderNode {
        throw new Error('Page component does not support buildRenderNode.');
    }

    buildLayoutNode(renderNode: IRenderNode): ILayoutNode {
        throw new Error('Page component does not support buildLayoutNode.');
    }

    buildPageLayoutNode() {
        const pageConfig = this.configService.getConfig().page;
        return new PageLayoutNode(
            this.getId(),
            pageConfig.width,
            pageConfig.height,
            pageConfig.paddingTop,
            pageConfig.paddingBottom,
            pageConfig.paddingLeft,
            pageConfig.paddingRight,
        );
    }

    buildViewNode(layoutNode: ILayoutNode) {
        if (layoutNode instanceof PageLayoutNode) {
            return new PageViewNode(layoutNode);
        }
        throw new Error('Invalid layout render node.');
    }
}
