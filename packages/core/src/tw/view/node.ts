import { INode, Node } from '../tree/node';
import { NodeList } from '../tree/node-list';

export type IViewNodeType = 'doc' | 'page' | 'block' | 'line' | 'text' | 'atom';

export interface IViewNode<TStyle> extends INode<IViewNode<TStyle>> {
    readonly type: IViewNodeType;
    readonly componentId: string | null;
    readonly partId: string | null;
    readonly renderId: string | null;
    readonly layoutId: string | null;
    readonly size: number;
    readonly domContainer: HTMLElement;
    readonly domContentContainer: HTMLElement;
}

export abstract class ViewNode<TStyle> extends Node<IViewNode<TStyle>> implements IViewNode<TStyle> {
    abstract get type(): IViewNodeType;
    abstract get partId(): string | null;
    abstract get domContainer(): HTMLElement;
    abstract get domContentContainer(): HTMLElement;

    protected internalSize?: number;

    constructor(
        readonly componentId: string | null,
        readonly renderId: string | null,
        readonly layoutId: string,
        protected readonly text: string,
        protected readonly style: TStyle,
        children: IViewNode<any>[],
    ) {
        super(layoutId);
        this.internalChildren = new NodeList(children);
    }

    get size() {
        if (this.internalSize === undefined) {
            if (this.leaf) {
                this.internalSize = this.text.length;
            } else {
                this.internalSize = this.children.reduce((size, child) => size + child.size, 0);
            }
        }
        return this.internalSize;
    }

    protected handleChildDidUpdate = () => {
        this.didUpdateEventEmitter.emit({});
    };
}
