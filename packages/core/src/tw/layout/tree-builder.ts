import { IComponentService } from 'tw/component/service';
import { BlockLayoutNode } from 'tw/layout/block-node';
import { DocLayoutNode } from 'tw/layout/doc-node';
import { LineLayoutNode } from 'tw/layout/line-node';
import { ILayoutNode } from 'tw/layout/node';
import { PageLayoutNode } from 'tw/layout/page-node';
import { IRenderNode } from 'tw/render/node';
import { generateId } from 'tw/util/id';

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
            throw new Error(`Component ${component} is not registered.`);
        }
        const layoutNode = component.buildLayoutNode(renderNode);
        if (!renderNode.isLeaf() && !layoutNode.isLeaf()) {
            const childLayoutNodes = renderNode.getChildren().map(childRenderNode => this.buildNode(childRenderNode));
            if (layoutNode instanceof DocLayoutNode) {
                const pageLayoutNode = new PageLayoutNode('', generateId());
                pageLayoutNode.setChildren(childLayoutNodes as any);
                layoutNode.setChildren([pageLayoutNode]);
            } else if (layoutNode instanceof BlockLayoutNode) {
                const lineLayoutNode = new LineLayoutNode('', generateId());
                lineLayoutNode.setChildren(childLayoutNodes as any);
                layoutNode.setChildren([lineLayoutNode]);
            } else {
                layoutNode.setChildren(childLayoutNodes);
            }
        }
        return layoutNode;
    }
}
