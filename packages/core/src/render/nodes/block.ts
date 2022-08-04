import { Disposable } from '../../event/emitter';
import { BaseRenderNode } from './base';
import { TextRenderNode } from './text';
import { InlineRenderNode } from './inline';

export interface BlockStyle {
    readonly paddingTop: number;
    readonly paddingBottom: number;
    readonly paddingLeft: number;
    readonly paddingRight: number;
    readonly lineHeight: number;
}

export type BlockRenderChildNode = TextRenderNode | InlineRenderNode;

export class BlockRenderNode extends BaseRenderNode<BlockStyle> {
    readonly type = 'block';

    protected internalChildren: BlockRenderChildNode[] = [];
    protected internalSize?: number;
    protected childDidUpdateDisposableMap: Map<string, Disposable> = new Map();

    constructor(readonly modelId: string) {
        super({
            paddingTop: 0,
            paddingBottom: 0,
            paddingLeft: 0,
            paddingRight: 0,
            lineHeight: 1,
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

    setChildren(children: BlockRenderChildNode[]) {
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
