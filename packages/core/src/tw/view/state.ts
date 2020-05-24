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
        this.doc = this.updateNode(null, layoutDoc, renderDoc) as IViewDoc<any>;
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

    protected updateNode(
        node: IViewNode<any> | null,
        layoutNode: ILayoutNode,
        renderNode: IRenderNode<any, any> | null,
    ) {
        if (!layoutNode.needView) {
            if (!node) {
                throw new Error('Expected view node to be available.');
            }
            return node;
        }
        const childrenMap: { [key: string]: IViewNode<any> } = {};
        if (node) {
            node.children.forEach((child) => {
                if (!child.layoutId) {
                    return;
                }
                childrenMap[child.layoutId] = child;
            });
        }
        const renderChildrenMap: { [key: string]: IRenderNode<any, any> } = {};
        if (renderNode) {
            renderNode.children.forEach((renderChild) => {
                renderChildrenMap[renderChild.id] = renderChild;
            });
        }
        const newChildren: IViewNode<any>[] = [];
        layoutNode.children.forEach((layoutChild) => {
            let child = childrenMap[layoutChild.id] || null;
            let renderChild: IRenderNode<any, any> | null = null;
            if (layoutChild.renderId) {
                renderChild = renderChildrenMap[layoutChild.renderId] || null;
                if (!renderChild) {
                    throw new Error('Render node not found.');
                }
            }
            newChildren.push(this.updateNode(child, layoutChild, renderChild));
        });
        layoutNode.clearNeedView();
        return this.buildNode(layoutNode, renderNode, newChildren);
    }

    protected buildNode(layoutNode: ILayoutNode, renderNode: IRenderNode<any, any> | null, children: IViewNode<any>[]) {
        if (!renderNode) {
            switch (layoutNode.type) {
                case 'page':
                    return this.buildPageNode(layoutNode, children);
                case 'line':
                    return this.buildLineNode(layoutNode, children);
                default:
                    throw new Error('Missing render node.');
            }
        }
        const component = this.componentService.getComponent(renderNode.componentId);
        let node: IViewNode<any> | undefined;
        if (layoutNode.type === 'text') {
            const text = layoutNode.children.map((child) => child.text).join('');
            node = component.buildViewNode(
                renderNode.partId,
                renderNode.id,
                layoutNode.id,
                text,
                renderNode.style,
                children,
                layoutNode.width,
                layoutNode.height,
                layoutNode.paddingTop,
                layoutNode.paddingBottom,
                layoutNode.paddingLeft,
                layoutNode.paddingRight,
            );
        } else {
            node = component.buildViewNode(
                renderNode.partId,
                renderNode.id,
                layoutNode.id,
                layoutNode.text,
                renderNode.style,
                children,
                layoutNode.width,
                layoutNode.height,
                layoutNode.paddingTop,
                layoutNode.paddingBottom,
                layoutNode.paddingLeft,
                layoutNode.paddingRight,
            );
        }
        if (!node) {
            throw new Error(`Error building view node from render node ${renderNode.id}.`);
        }
        return node;
    }

    protected buildPageNode(layoutNode: ILayoutNode, children: IViewNode<any>[]) {
        return this.componentService
            .getPageComponent()
            .buildViewNode(
                layoutNode.id,
                children,
                layoutNode.width,
                layoutNode.height,
                layoutNode.paddingTop,
                layoutNode.paddingBottom,
                layoutNode.paddingLeft,
                layoutNode.paddingRight,
            );
    }

    protected buildLineNode(layoutNode: ILayoutNode, children: IViewNode<any>[]) {
        return this.componentService
            .getLineComponent()
            .buildViewNode(
                layoutNode.id,
                children,
                layoutNode.width,
                layoutNode.height,
                layoutNode.paddingTop,
                layoutNode.paddingBottom,
                layoutNode.paddingLeft,
                layoutNode.paddingRight,
            );
    }
}
