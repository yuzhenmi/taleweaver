import { DOMService } from '../../dom/service';
import { Disposable } from '../../event/emitter';
import { BlockLayout } from '../../layout/nodes/block';
import { BaseViewNode, setDOMContainerChildren } from './base';
import { LineViewNode } from './line';

export type BlockViewChildNode = LineViewNode;

export class BlockViewNode extends BaseViewNode<BlockLayout> {
    readonly type = 'block';
    readonly domContainer: HTMLDivElement;

    protected internalChildren: BlockViewChildNode[] = [];
    protected childDidUpdateDisposableMap: Map<string, Disposable> = new Map();

    constructor(layoutId: string, protected domService: DOMService) {
        super(layoutId);
        this.domContainer = domService.createElement('div', { role: 'block', className: 'block--container' });
        this.domContainer.style.display = 'block';
        this.domContainer.style.width = '0px';
        this.domContainer.style.height = '0px';
        this.domContainer.style.paddingTop = '0px';
        this.domContainer.style.paddingBottom = '0px';
        this.domContainer.style.paddingLeft = '0px';
        this.domContainer.style.paddingRight = '0px';
        this.domContainer.style.lineHeight = '1em';
    }

    get children() {
        return this.internalChildren.slice();
    }

    setChildren(children: BlockViewChildNode[]) {
        this.childDidUpdateDisposableMap.forEach((disposable) => disposable.dispose());
        this.childDidUpdateDisposableMap.clear();
        children.forEach((child) =>
            this.childDidUpdateDisposableMap.set(child.id, child.onDidUpdate(this.handleChildDidUpdate)),
        );
        this.internalChildren = children;
        setDOMContainerChildren(
            this.domContainer,
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
