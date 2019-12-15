import { Component } from 'tw/component/component';
import { IPageComponent } from 'tw/component/page-component';
import { ILayoutNode } from 'tw/layout/node';
import { PageLayoutNode as AbstractPageLayoutNode } from 'tw/layout/page-node';
import { IAttributes, IModelNode } from 'tw/model/node';
import { IRenderNode } from 'tw/render/node';
import { PageViewNode as AbstractPageViewNode } from 'tw/view/page-node';

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

    constructor(layoutNode: PageLayoutNode) {
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

export class PageComponent extends Component implements IPageComponent {
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
        return new PageLayoutNode(this.getId(), 816, 1056, 40, 40, 40, 40);
    }

    buildViewNode(layoutNode: ILayoutNode) {
        if (layoutNode instanceof PageLayoutNode) {
            return new PageViewNode(layoutNode);
        }
        throw new Error('Invalid layout render node.');
    }
}
