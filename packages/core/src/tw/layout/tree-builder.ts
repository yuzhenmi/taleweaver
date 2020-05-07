import { IComponentService } from '../component/service';
import { IRenderNode } from '../render/node';
import { ILayoutNode } from './node';

export interface ILayoutTreeBuilder {
    buildTree(renderNode: IRenderNode<any>): ILayoutNode;
}

export class LayoutTreeBuilder implements ILayoutTreeBuilder {
    protected rootRenderNode?: IRenderNode<any>;
    protected rootLayoutNode?: ILayoutNode;
    protected ran: boolean = false;

    constructor(protected componentService: IComponentService) {}

    buildTree(renderNode: IRenderNode<any>) {
        if (this.ran) {
            throw new Error('Tree builder has already been run.');
        }
        this.rootRenderNode = renderNode;
        this._buildTree();
        this.ran = true;
        return this.rootLayoutNode!;
    }

    protected _buildTree() {
        this.rootLayoutNode = this.buildNode(this.rootRenderNode!);
        this.ran = true;
    }

    protected buildNode(renderNode: IRenderNode<any>) {
        const component = this.componentService.getComponent(renderNode.componentId);
        if (!component) {
            throw new Error(`Component ${renderNode.componentId} is not registered.`);
        }
        const layoutNode = component.buildLayoutNode(renderNode);
        if (!layoutNode) {
            throw new Error(`Could not build layout node from render node ${renderNode.id}.`);
        }
        const childLayoutNodes = renderNode.children.map((childRenderNode) => this.buildNode(childRenderNode));
        switch (layoutNode.type) {
            case 'doc':
                const pageLayoutNode = this.componentService.getPageComponent().buildPageLayoutNode();
                childLayoutNodes.forEach((childLayoutNode) => {
                    pageLayoutNode.appendChild(childLayoutNode as any);
                });
                layoutNode.appendChild(pageLayoutNode);
                break;
            case 'block':
                const lineLayoutNode = this.componentService.getLineComponent().buildLineLayoutNode();
                childLayoutNodes.forEach((childLayoutNode) => {
                    lineLayoutNode.appendChild(childLayoutNode as any);
                });
                layoutNode.appendChild(lineLayoutNode);
                break;
            default:
                childLayoutNodes.forEach((childLayoutNode) => {
                    layoutNode.appendChild(childLayoutNode as any);
                });
        }
        return layoutNode;
    }
}
