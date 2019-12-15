import { Component } from 'tw/component/component';
import { ILineComponent } from 'tw/component/line-component';
import { LineLayoutNode as AbstractLineLayoutNode } from 'tw/layout/line-node';
import { ILayoutNode } from 'tw/layout/node';
import { IAttributes, IModelNode } from 'tw/model/node';
import { IRenderNode } from 'tw/render/node';
import { LineViewNode as AbstractLineViewNode } from 'tw/view/line-node';

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
