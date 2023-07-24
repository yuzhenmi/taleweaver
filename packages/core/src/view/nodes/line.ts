import { DOMService } from '../../dom/service';
import { Disposable } from '../../event/emitter';
import { LineLayout } from '../../layout/nodes/line';
import { BaseViewNode, setDOMContainerChildren } from './base';
import { InlineViewNode } from './inline';
import { TextViewNode } from './text';

export type LineViewChildNode = TextViewNode | InlineViewNode;

export class LineViewNode extends BaseViewNode<LineLayout> {
    readonly type = 'line';
    readonly domContainer: HTMLDivElement;

    protected internalChildren: LineViewChildNode[] = [];
    protected childDidUpdateDisposableMap: Map<string, Disposable> = new Map();

    constructor(layoutId: string, protected domService: DOMService) {
        super(layoutId);
        this.domContainer = domService.createElement('div', { role: 'line', className: 'line--container' });
        this.domContainer.style.display = 'block';
    }

    get children() {
        return this.internalChildren.slice();
    }

    setChildren(children: LineViewChildNode[]) {
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
        this.domContainer.style.whiteSpace = 'nowrap';
    }

    protected handleChildDidUpdate = () => {
        this.didUpdateEventEmitter.emit({});
    };
}
