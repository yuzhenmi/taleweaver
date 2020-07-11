import { IComponentService } from '../component/service';
import { IDOMService } from '../dom/service';
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
    readonly domContainer: HTMLElement | null;

    onDidUpdateViewState: IOnEvent<IDidUpdateViewStateEvent>;
    attach(domContainer: HTMLElement): void;
}

export class ViewState implements IViewState {
    protected didUpdateViewStateEventEmitter = new EventEmitter<IDidUpdateViewStateEvent>();
    protected internalDOMContainer: HTMLElement | null = null;

    protected internalDoc: IViewDoc<any>;

    constructor(
        protected instanceId: string,
        protected componentService: IComponentService,
        protected layoutService: ILayoutService,
        protected renderService: IRenderService,
        protected domService: IDOMService,
    ) {
        const layoutDoc = layoutService.getDoc();
        const renderDoc = renderService.getDoc();
        this.internalDoc = this.updateNode(null, layoutDoc, renderDoc) as IViewDoc<any>;
        layoutService.onDidUpdateLayoutState((event) => this.handleDidUpdateLayoutStateEvent(event));
    }

    get doc() {
        return this.internalDoc;
    }

    get domContainer() {
        return this.internalDOMContainer;
    }

    onDidUpdateViewState(listener: IEventListener<IDidUpdateViewStateEvent>) {
        return this.didUpdateViewStateEventEmitter.on(listener);
    }

    attach(domContainer: HTMLElement) {
        this.internalDOMContainer = domContainer;
        this.reattachDoc();
    }

    protected handleDidUpdateLayoutStateEvent(event: IDidUpdateLayoutStateEvent) {
        this.update();
    }

    protected update() {
        const layoutDoc = this.layoutService.getDoc();
        const renderDoc = this.renderService.getDoc();
        this.internalDoc = this.updateNode(this.doc, layoutDoc, renderDoc) as IViewDoc<any>;
        this.reattachDoc();
        this.didUpdateViewStateEventEmitter.emit({});
    }

    protected reattachDoc() {
        if (!this.domContainer) {
            return;
        }
        this.domContainer.innerHTML = '';
        this.domContainer.appendChild(this.doc.domContainer);
    }

    protected updateNode(node: IViewNode<any> | null, layoutNode: ILayoutNode, renderNode: IRenderNode<any, any>) {
        if (!layoutNode.needView && node) {
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
        if (layoutNode.type !== 'text') {
            layoutNode.children.forEach((layoutChild) => {
                let child = childrenMap[layoutChild.id] || null;
                let renderChild: IRenderNode<any, any> | null = null;
                if (layoutChild.renderId) {
                    renderChild = renderChildrenMap[layoutChild.renderId] || null;
                    if (!renderChild) {
                        throw new Error('Render node not found.');
                    }
                }
                newChildren.push(this.updateNode(child, layoutChild, renderChild || renderNode));
            });
        }
        layoutNode.clearNeedView();
        const domContainer = node ? node.domContainer : this.domService.createContainer();
        const newNode = this.buildNode(domContainer, layoutNode, renderNode, newChildren);
        return newNode;
    }

    protected buildNode(
        domContainer: HTMLElement,
        layoutNode: ILayoutNode,
        renderNode: IRenderNode<any, any>,
        children: IViewNode<any>[],
    ) {
        switch (layoutNode.type) {
            case 'page':
                return this.buildPageNode(domContainer, layoutNode, children);
            case 'line':
                return this.buildLineNode(domContainer, layoutNode, children);
        }
        const component = this.componentService.getComponent(renderNode.componentId);
        const text =
            layoutNode.type === 'text' ? layoutNode.children.map((child) => child.text).join('') : layoutNode.text;
        const node = component.buildViewNode(
            domContainer,
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
        if (!node) {
            throw new Error(`Error building view node from render node ${renderNode.id}.`);
        }
        this.applyMetadataToDOMContainer(node);
        return node;
    }

    protected buildPageNode(domContainer: HTMLElement, layoutNode: ILayoutNode, children: IViewNode<any>[]) {
        const node = this.componentService
            .getPageComponent()
            .buildViewNode(
                domContainer,
                layoutNode.id,
                children,
                layoutNode.width,
                layoutNode.height,
                layoutNode.paddingTop,
                layoutNode.paddingBottom,
                layoutNode.paddingLeft,
                layoutNode.paddingRight,
            );
        this.applyMetadataToDOMContainer(node);
        return node;
    }

    protected buildLineNode(domContainer: HTMLElement, layoutNode: ILayoutNode, children: IViewNode<any>[]) {
        const node = this.componentService
            .getLineComponent()
            .buildViewNode(
                domContainer,
                layoutNode.id,
                children,
                layoutNode.width,
                layoutNode.height,
                layoutNode.paddingTop,
                layoutNode.paddingBottom,
                layoutNode.paddingLeft,
                layoutNode.paddingRight,
            );
        this.applyMetadataToDOMContainer(node);
        return node;
    }

    protected applyMetadataToDOMContainer(viewNode: IViewNode<any>) {
        const domContainer = viewNode.domContainer;
        const componentId = viewNode.componentId;
        const partId = viewNode.partId;
        const id = viewNode.id;
        domContainer.className = `tw--${componentId}--${partId}`;
        domContainer.setAttribute('data-tw-instance', this.instanceId);
        if (componentId) {
            domContainer.setAttribute('data-tw-component', componentId);
        }
        if (partId) {
            domContainer.setAttribute('data-tw-part', partId);
        }
        domContainer.setAttribute('data-tw-id', id);
    }
}
