import { LineLayoutNode as AbstractLineLayoutNode } from '../../layout/line-node';
import { ILayoutNode } from '../../layout/node';
import { IAttributes, IModelNode } from '../../model/node';
import { IRenderNode } from '../../render/node';
import { LineViewNode as AbstractLineViewNode } from '../../view/line-node';
import { Component } from '../component';
import { ILineComponent } from '../line-component';

export class LineLayoutNode extends AbstractLineLayoutNode {
    getPartId() {
        return 'line';
    }

    clone() {
        return new LineLayoutNode(this.getComponentId());
    }
}

export class LineViewNode extends AbstractLineViewNode<LineLayoutNode> {
    protected domContainer: HTMLDivElement;

    constructor(layoutNode: LineLayoutNode) {
        super(layoutNode);
        this.domContainer = document.createElement('div');
    }

    getDOMContainer() {
        return this.domContainer;
    }

    getDOMContentContainer() {
        return this.domContainer;
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

export class LineComponent extends Component implements ILineComponent {
    buildModelNode(partId: string | undefined, id: string, attributes: IAttributes): IModelNode {
        throw new Error('Line component does not support buildModelNode.');
    }

    buildRenderNode(modelNode: IModelNode): IRenderNode {
        throw new Error('Line component does not support buildRenderNode.');
    }

    buildLayoutNode(renderNode: IRenderNode): ILayoutNode {
        throw new Error('Line component does not support buildLayoutNode.');
    }

    buildLineLayoutNode() {
        return new LineLayoutNode(this.getId());
    }

    buildViewNode(layoutNode: ILayoutNode) {
        if (layoutNode instanceof LineLayoutNode) {
            return new LineViewNode(layoutNode);
        }
        throw new Error('Invalid layout render node.');
    }
}
