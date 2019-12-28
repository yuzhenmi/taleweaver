import { IComponentService } from '../component/service';
import { ILayoutNode } from '../layout/node';
import { IViewNode } from './node';

export interface IViewTreeBuilder {
    buildTree(layoutNode: ILayoutNode): IViewNode;
}

export class ViewTreeBuilder implements IViewTreeBuilder {
    protected rootLayoutNode?: ILayoutNode;
    protected rootViewNode?: IViewNode;
    protected ran: boolean = false;

    constructor(protected instanceId: string, protected componentService: IComponentService) {}

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
        const component = this.componentService.getComponent(layoutNode.getComponentId());
        if (!component) {
            throw new Error(`Component ${layoutNode.getComponentId()} is not registered.`);
        }
        const viewNode = component.buildViewNode(layoutNode);
        if (!viewNode) {
            throw new Error(`Could not build view node from layout node ${layoutNode.getId()}.`);
        }
        if (!viewNode.isLeaf() && !viewNode.isLeaf()) {
            const childViewNodes = layoutNode.getChildren().map(childLayoutNode => this.buildNode(childLayoutNode));
            childViewNodes.forEach(childViewNode => viewNode.appendChild(childViewNode));
        }
        this.applyMetadataToDOMContainer(viewNode);
        viewNode.onLayoutDidUpdate();
        return viewNode;
    }

    protected applyMetadataToDOMContainer(viewNode: IViewNode) {
        const domContainer = viewNode.getDOMContainer();
        const componentId = viewNode.getComponentId();
        const partId = viewNode.getPartId();
        const id = viewNode.getId();
        domContainer.className = `tw--${componentId}--${partId}`;
        domContainer.setAttribute('data-tw-instance', this.instanceId);
        domContainer.setAttribute('data-tw-component', componentId);
        domContainer.setAttribute('data-tw-part', partId);
        domContainer.setAttribute('data-tw-id', id);
    }
}
