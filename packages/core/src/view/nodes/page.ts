import { DOMService } from '../../dom/service';
import { Disposable } from '../../event/emitter';
import { PageLayout } from '../../layout/nodes/page';
import { BaseViewNode, setDOMContainerChildren } from './base';
import { BlockViewNode } from './block';

export type PageViewChildNode = BlockViewNode;

export class PageViewNode extends BaseViewNode<PageLayout> {
    readonly type = 'page';
    readonly domContainer: HTMLDivElement;
    readonly domContentContainer: HTMLDivElement;

    protected internalChildren: PageViewChildNode[] = [];
    protected childDidUpdateDisposableMap: Map<string, Disposable> = new Map();

    constructor(layoutId: string, protected domService: DOMService) {
        super(layoutId);
        this.domContainer = domService.createElement('div', { role: 'page', className: 'page--container' });
        this.domContainer.style.display = 'block';
        this.domContainer.style.position = 'relative';
        this.domContainer.style.marginLeft = 'auto';
        this.domContainer.style.marginRight = 'auto';
        this.domContainer.style.width = '0px';
        this.domContainer.style.height = '0px';
        this.domContainer.style.paddingTop = '0px';
        this.domContainer.style.paddingBottom = '0px';
        this.domContainer.style.paddingLeft = '0px';
        this.domContainer.style.paddingRight = '0px';
        this.domContentContainer = domService.createElement('div', {
            role: 'page-content',
            className: 'page--content',
        });
        this.domContentContainer.style.display = 'block';
        this.domContainer.appendChild(this.domContentContainer);
    }

    get children() {
        return this.internalChildren.slice();
    }

    setChildren(children: PageViewChildNode[]) {
        this.childDidUpdateDisposableMap.forEach((disposable) => disposable.dispose());
        this.childDidUpdateDisposableMap.clear();
        children.forEach((child) =>
            this.childDidUpdateDisposableMap.set(child.id, child.onDidUpdate(this.handleChildDidUpdate)),
        );
        this.internalChildren = children;
        setDOMContainerChildren(
            this.domContentContainer,
            children.map((child) => child.domContainer),
        );
        this.didUpdateEventEmitter.emit({});
    }

    protected updateDOMLayout() {
        this.domContainer.style.width = `${this.layout.width}px`;
        this.domContainer.style.height = `${this.layout.height}px`;
        this.domContainer.style.paddingTop = `${this.layout.paddingTop}px`;
        this.domContainer.style.paddingBottom = `${this.layout.paddingBottom}px`;
        this.domContainer.style.paddingLeft = `${this.layout.paddingLeft}px`;
        this.domContainer.style.paddingRight = `${this.layout.paddingRight}px`;
    }

    protected handleChildDidUpdate = () => {
        this.didUpdateEventEmitter.emit({});
    };
}
