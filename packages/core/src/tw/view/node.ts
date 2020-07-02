import { IDOMService } from '../dom/service';
import { INode, Node } from '../tree/node';
import { NodeList } from '../tree/node-list';

export type IViewNodeType = 'doc' | 'page' | 'block' | 'line' | 'text' | 'atom';

export interface IViewNode<TStyle> extends INode<IViewNode<TStyle>> {
    readonly type: IViewNodeType;
    readonly componentId: string | null;
    readonly partId: string | null;
    readonly renderId: string | null;
    readonly layoutId: string;
    readonly size: number;
    readonly domContainer: HTMLElement;
}

export abstract class ViewNode<TStyle> extends Node<IViewNode<TStyle>> implements IViewNode<TStyle> {
    abstract get type(): IViewNodeType;
    abstract get partId(): string | null;

    protected internalSize?: number;

    constructor(
        readonly domContainer: HTMLElement,
        readonly componentId: string | null,
        readonly renderId: string | null,
        readonly layoutId: string,
        protected readonly text: string,
        protected readonly style: TStyle,
        children: IViewNode<any>[],
        protected domService: IDOMService,
    ) {
        super(layoutId);
        this.internalChildren = new NodeList(children);
        children.forEach((child) => {
            child.parent = this;
        });
    }

    get contentLength() {
        if (this.leaf) {
            return this.text.length;
        }
        return this.children.length;
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
}
