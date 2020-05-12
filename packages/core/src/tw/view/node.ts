import { INode, Node } from '../tree/node';

export type IViewNodeType = 'doc' | 'page' | 'block' | 'line' | 'text' | 'atom';

export interface IViewNode<TStyle> extends INode<IViewNode<TStyle>> {
    readonly type: IViewNodeType;
    readonly componentId: string | null;
    readonly partId: string | null;
    readonly renderId: string | null;
    readonly layoutId: string | null;
    readonly style: TStyle;
    readonly size: number;
    readonly domContainer: HTMLElement;
}

export abstract class ViewNode<TStyle> extends Node<IViewNode<TStyle>> implements IViewNode<TStyle> {
    abstract get type(): IViewNodeType;
    abstract get partId(): string | null;
    abstract get domContainer(): HTMLElement;

    protected internalSize?: number;

    constructor(
        readonly componentId: string | null,
        readonly renderId: string | null,
        readonly layoutId: string,
        readonly style: TStyle,
        readonly text: string,
    ) {
        super(layoutId);
        this.onDidUpdateNode(() => {
            this.internalSize = undefined;
        });
    }

    get size() {
        if (this.internalSize === undefined) {
            if (this.leaf) {
                this.internalSize = this.text.length;
            }
            this.internalSize = this.children.reduce((size, child) => size + child.size, 0);
        }
        return this.internalSize;
    }
}
