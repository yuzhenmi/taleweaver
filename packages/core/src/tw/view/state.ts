import { IComponentService } from '../component/service';
import { EventEmitter } from '../event/emitter';
import { IEventListener, IOnEvent } from '../event/listener';
import { ILayoutNode } from '../layout/node';
import { ILayoutService } from '../layout/service';
import { IDidUpdateLayoutStateEvent } from '../layout/state';
import { IRenderNode } from '../render/node';
import { IRenderService } from '../render/service';
import { IViewDoc } from './doc';
import { IViewNode } from './node';

export interface IDidUpdateViewStateEvent {}

export interface IViewState {
    readonly doc: IViewDoc<any>;

    onDidUpdateViewState: IOnEvent<IDidUpdateViewStateEvent>;
    attach(domContainer: HTMLElement): void;
}

export class ViewState implements IViewState {
    protected attached = false;
    protected didUpdateViewStateEventEmitter = new EventEmitter<IDidUpdateViewStateEvent>();

    readonly doc: IViewDoc<any>;

    constructor(
        protected instanceId: string,
        protected componentService: IComponentService,
        protected layoutService: ILayoutService,
        protected renderService: IRenderService,
    ) {
        const layoutDoc = layoutService.getDoc();
        const renderDoc = renderService.getDoc();
        this.doc = this.buildNode(layoutDoc, renderDoc) as IViewDoc<any>;
        this.updateNode(this.doc, layoutDoc, renderDoc);
        layoutService.onDidUpdateLayoutState(this.handleDidUpdateLayoutStateEvent);
    }

    onDidUpdateViewState(listener: IEventListener<IDidUpdateViewStateEvent>) {
        return this.didUpdateViewStateEventEmitter.on(listener);
    }

    getDoc() {
        return this.doc;
    }

    attach(domContainer: HTMLElement) {
        if (this.attached) {
            throw new Error('View is already attached to the DOM.');
        }
        this.doc.attach(domContainer);
        this.attached = true;
    }

    protected handleDidUpdateLayoutStateEvent = (event: IDidUpdateLayoutStateEvent) => {
        const layoutDoc = this.layoutService.getDoc();
        const renderDoc = this.renderService.getDoc();
        this.updateNode(this.doc, layoutDoc, renderDoc);
        this.didUpdateViewStateEventEmitter.emit({});
    };

    protected updateNode(node: IViewNode<any>, layoutNode: ILayoutNode, renderNode?: IRenderNode<any>) {
        node.update(layoutNode.text, renderNode?.style);
        const childrenMap: { [key: string]: IViewNode<any> } = {};
        node.children.forEach((child) => {
            if (!child.layoutId) {
                return;
            }
            childrenMap[child.layoutId] = child;
        });
        const renderChildrenMap: { [key: string]: IRenderNode<any> } = {};
        if (renderNode) {
            renderNode.children.forEach((renderChild) => {
                renderChildrenMap[renderChild.id] = renderChild;
            });
        }
        const newChildren: IViewNode<any>[] = [];
        layoutNode.children.forEach((layoutChild) => {
            let child = childrenMap[layoutChild.id];
            let renderChild: IRenderNode<any> | undefined;
            if (layoutChild.renderId) {
                renderChild = renderChildrenMap[layoutChild.renderId];
                if (!renderChild) {
                    throw new Error('Render node not found.');
                }
            }
            if (!child) {
                if (!layoutNode) {
                    throw new Error('Layout node not found.');
                }
                child = this.buildNode(layoutNode, renderNode);
            }
            newChildren.push(child);
            if (layoutChild.needView) {
                this.updateNode(child, layoutChild, renderChild);
            }
        });
        node.setChildren(newChildren);
        layoutNode.clearNeedView();
    }

    protected buildNode(layoutNode: ILayoutNode, renderNode?: IRenderNode<any>) {
        if (!renderNode) {
            switch (layoutNode.type) {
                case 'page':
                    return this.buildPageNode(layoutNode);
                case 'line':
                    return this.buildLineNode(layoutNode);
                default:
                    throw new Error('Missing render node.');
            }
        }
        const component = this.componentService.getComponent(renderNode.componentId);
        const node = component.buildViewNode(
            renderNode.partId,
            renderNode.id,
            layoutNode.id,
            layoutNode.text,
            renderNode.style,
        );
        if (!node) {
            throw new Error(`Error building view node from render node ${renderNode.id}.`);
        }
        return node;
    }

    protected buildPageNode(layoutNode: ILayoutNode) {
        return this.componentService.getPageComponent().buildViewNode(layoutNode.id);
    }

    protected buildLineNode(layoutNode: ILayoutNode) {
        return this.componentService.getLineComponent().buildViewNode(layoutNode.id);
    }
}
