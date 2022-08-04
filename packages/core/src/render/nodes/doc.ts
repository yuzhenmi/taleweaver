import { Disposable } from '../../event/emitter';
import { BaseRenderNode } from './base';
import { BlockRenderNode } from './block';

export interface DocStyle {
    readonly pageWidth: number;
    readonly pageHeight: number;
    readonly pagePaddingTop: number;
    readonly pagePaddingBottom: number;
    readonly pagePaddingLeft: number;
    readonly pagePaddingRight: number;
}

export type DocRenderChildNode = BlockRenderNode;

export class DocRenderNode extends BaseRenderNode<DocStyle> {
    readonly type = 'doc';

    protected internalChildren: DocRenderChildNode[] = [];
    protected internalSize?: number;
    protected childDidUpdateDisposableMap: Map<string, Disposable> = new Map();

    constructor(readonly modelId: string) {
        super({
            pageWidth: 0,
            pageHeight: 0,
            pagePaddingTop: 0,
            pagePaddingBottom: 0,
            pagePaddingLeft: 0,
            pagePaddingRight: 0,
        });
        this.onDidUpdate(() => {
            this.internalSize = undefined;
        });
    }

    get children() {
        return this.internalChildren.slice();
    }

    get size() {
        if (this.internalSize === undefined) {
            this.internalSize = this.calculateSize();
        }
        return this.internalSize;
    }

    setChildren(children: DocRenderChildNode[]) {
        this.childDidUpdateDisposableMap.forEach((disposable) => disposable.dispose());
        this.childDidUpdateDisposableMap.clear();
        children.forEach((child) =>
            this.childDidUpdateDisposableMap.set(child.id, child.onDidUpdate(this.handleChildDidUpdate)),
        );
        this.internalChildren = children;
        this.didUpdateEventEmitter.emit({});
    }

    protected calculateSize() {
        return this.internalChildren.reduce((size, child) => size + child.size, 0);
    }

    protected handleChildDidUpdate = () => {
        this.didUpdateEventEmitter.emit({});
    };
}
