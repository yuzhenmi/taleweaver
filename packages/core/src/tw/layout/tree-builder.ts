import { IComponentService } from '../component/service';
import { IRenderNode } from '../render/node';
import { BlockLayoutNode } from './block-node';
import { DocLayoutNode } from './doc-node';
import { ILayoutNode } from './node';

export interface ILayoutTreeBuilder {
    buildTree(renderNode: IRenderNode): ILayoutNode;
}

export class LayoutTreeBuilder implements ILayoutTreeBuilder {
    protected rootRenderNode?: IRenderNode;
    protected rootLayoutNode?: ILayoutNode;
    protected ran: boolean = false;

    constructor(protected componentService: IComponentService) {}

    buildTree(renderNode: IRenderNode) {
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

    protected buildNode(renderNode: IRenderNode) {
        const component = this.componentService.getComponent(renderNode.getComponentId());
        if (!component) {
            throw new Error(`Component ${renderNode.getComponentId()} is not registered.`);
        }
        const layoutNode = component.buildLayoutNode(renderNode);
        if (!layoutNode) {
            throw new Error(`Could not build layout node from render node ${renderNode.getId()}.`);
        }
        if (!renderNode.isLeaf() && !layoutNode.isLeaf()) {
            const childLayoutNodes = renderNode.getChildren().map(childRenderNode => this.buildNode(childRenderNode));
            if (layoutNode instanceof DocLayoutNode) {
                const pageLayoutNode = this.componentService.getPageComponent().buildPageLayoutNode();
                childLayoutNodes.forEach(childLayoutNode => {
                    pageLayoutNode.appendChild(childLayoutNode as any);
                });
                layoutNode.appendChild(pageLayoutNode);
            } else if (layoutNode instanceof BlockLayoutNode) {
                const lineLayoutNode = this.componentService.getLineComponent().buildLineLayoutNode();
                childLayoutNodes.forEach(childLayoutNode => {
                    lineLayoutNode.appendChild(childLayoutNode as any);
                });
                layoutNode.appendChild(lineLayoutNode);
            } else {
                childLayoutNodes.forEach(childLayoutNode => {
                    layoutNode.appendChild(childLayoutNode as any);
                });
            }
        }
        return layoutNode;
    }
}
