import { IComponentService } from 'tw/component/service';
import { IModelNode } from 'tw/model/node';
import { IRenderNode } from './node';

export interface IRenderTreeBuilder {
    buildTree(modelNode: IModelNode): IRenderNode;
}

export class RenderTreeBuilder implements IRenderTreeBuilder {
    protected rootModelNode?: IModelNode;
    protected rootRenderNode?: IRenderNode;
    protected ran: boolean = false;

    constructor(protected componentService: IComponentService) {}

    buildTree(modelNode: IModelNode) {
        if (this.ran) {
            throw new Error('Tree builder has already been run.');
        }
        this.rootModelNode = modelNode;
        this._buildTree();
        this.ran = true;
        return this.rootRenderNode!;
    }

    protected _buildTree() {
        this.rootRenderNode = this.buildNode(this.rootModelNode!);
        this.ran = true;
    }

    protected buildNode(modelNode: IModelNode) {
        const component = this.componentService.getComponent(modelNode.getComponentId());
        if (!component) {
            throw new Error(`Component ${component} is not registered.`);
        }
        const renderNode = component.buildRenderNode(modelNode);
        if (!modelNode.isLeaf()) {
            const childRenderNodes = modelNode.getChildren().map(childModelNode => this.buildNode(childModelNode));
            renderNode.setChildren(childRenderNodes);
        }
        return renderNode;
    }
}
