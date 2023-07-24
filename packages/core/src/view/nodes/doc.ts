import { DOMService } from '../../dom/service';
import { Disposable } from '../../event/emitter';
import { DocLayout } from '../../layout/nodes/doc';
import { BaseViewNode, setDOMContainerChildren } from './base';
import { PageViewNode } from './page';

export type DocViewChildNode = PageViewNode;

export class DocViewNode extends BaseViewNode<DocLayout> {
    readonly type = 'doc';
    readonly domContainer: HTMLDivElement;
    readonly domContentContainer: HTMLDivElement;

    protected internalChildren: DocViewChildNode[] = [];
    protected childDidUpdateDisposableMap: Map<string, Disposable> = new Map();

    constructor(layoutId: string, protected domService: DOMService) {
        super(layoutId);
        this.domContainer = domService.createElement('div', { role: 'doc', className: 'doc--container' });
        this.domContainer.style.display = 'block';
        this.domContainer.style.textAlign = 'left';
        this.domContainer.style.cursor = 'text';
        this.domContainer.style.userSelect = 'none';
        this.domContentContainer = domService.createElement('div', { role: 'doc-content', className: 'doc--content' });
        this.domContentContainer.style.display = 'block';
        this.domContainer.appendChild(this.domContentContainer);
    }

    get children() {
        return this.internalChildren.slice();
    }

    setChildren(children: DocViewChildNode[]) {
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

    protected updateDOMLayout() {}

    protected handleChildDidUpdate = () => {
        this.didUpdateEventEmitter.emit({});
    };
}
