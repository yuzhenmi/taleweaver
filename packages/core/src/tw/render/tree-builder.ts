import { IComponentService } from '../component/service';
import { IModelNode } from '../model/node';
import { IRenderNode } from './node';

export interface IRenderTreeBuilder {
    buildTree(modelNode: IModelNode<any>): IRenderNode<any>;
}

export class RenderTreeBuilder implements IRenderTreeBuilder {
    protected rootModelNode?: IModelNode<any>;
    protected rootRenderNode?: IRenderNode<any>;
    protected ran: boolean = false;

    constructor(protected componentService: IComponentService) {}

    buildTree(modelNode: IModelNode<any>) {
        if (this.ran) {
            throw new Error('Tree builder has already been run.');
        }
        this.rootModelNode = modelNode;
        this.internalBuildTree();
        this.ran = true;
        return this.rootRenderNode!;
    }

    protected internalBuildTree() {
        this.rootRenderNode = this.buildNode(this.rootModelNode!);
        this.ran = true;
    }

    protected buildNode(modelNode: IModelNode<any>) {
        const component = this.componentService.getComponent(modelNode.componentId);
        if (!component) {
            throw new Error(`Component ${modelNode.componentId} is not registered.`);
        }
        const renderNode = component.buildRenderNode(modelNode);
        if (!renderNode) {
            throw new Error(`Error building render node from model node ${modelNode.id}.`);
        }
        if (!modelNode.leaf && !renderNode.leaf) {
            modelNode.children.forEach((modelChild) => {
                renderNode.appendChild(this.buildNode(modelChild));
            });
        }
        return renderNode;
    }
}
