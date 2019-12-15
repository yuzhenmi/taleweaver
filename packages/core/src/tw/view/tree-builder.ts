import { IComponentService } from 'tw/component/service';
import { LineLayoutNode } from 'tw/layout/line-node';
import { ILayoutNode } from 'tw/layout/node';
import { PageLayoutNode } from 'tw/layout/page-node';
import { LineViewNode } from 'tw/view/line-node';
import { IViewNode } from 'tw/view/node';
import { PageViewNode } from 'tw/view/page-node';

export interface IViewTreeBuilder {
    buildTree(layoutNode: ILayoutNode): IViewNode;
}

export class ViewTreeBuilder implements IViewTreeBuilder {
    protected rootLayoutNode?: ILayoutNode;
    protected rootViewNode?: IViewNode;
    protected ran: boolean = false;

    constructor(protected componentService: IComponentService) {}

    buildTree(layoutNode: ILayoutNode) {
        if (this.ran) {
            throw new Error('Tree builder has already been run.');
        }
        this.rootLayoutNode = layoutNode;
        this._buildTree();
        this.ran = true;
        return this.rootViewNode!;
    }

    protected _buildTree() {
        this.rootViewNode = this.buildNode(this.rootLayoutNode!);
        this.ran = true;
    }

    protected buildNode(layoutNode: ILayoutNode) {
        let viewNode: IViewNode;
        if (layoutNode instanceof PageLayoutNode) {
            viewNode = new PageViewNode(layoutNode);
        } else if (layoutNode instanceof LineLayoutNode) {
            viewNode = new LineViewNode(layoutNode);
        } else {
            const component = this.componentService.getComponent(layoutNode.getComponentId());
            if (!component) {
                throw new Error(`Component ${layoutNode.getComponentId()} is not registered.`);
            }
            viewNode = component.buildViewNode(layoutNode);
        }
        if (!viewNode.isLeaf() && !viewNode.isLeaf()) {
            const childViewNodes = layoutNode.getChildren().map(childLayoutNode => this.buildNode(childLayoutNode));
            childViewNodes.forEach(childViewNode => viewNode.appendChild(childViewNode));
        }
        return viewNode;
    }
}
