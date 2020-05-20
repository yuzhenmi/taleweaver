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
    readonly domContentContainer: HTMLElement;

    update(
        text: string,
        width: number,
        height: number,
        paddingTop: number,
        paddingBottom: number,
        paddingLeft: number,
        paddingRight: number,
        style: TStyle,
    ): void;
}

export abstract class ViewNode<TStyle> extends Node<IViewNode<TStyle>> implements IViewNode<TStyle> {
    abstract get type(): IViewNodeType;
    abstract get partId(): string | null;
    abstract get domContainer(): HTMLElement;
    abstract get domContentContainer(): HTMLElement;

    protected internalText?: string;
    protected internalStyle?: TStyle;
    protected internalSize?: number;

    constructor(readonly componentId: string | null, readonly renderId: string | null, readonly layoutId: string) {
        super(layoutId);
        this.onDidUpdateNode(() => {
            this.internalSize = undefined;
        });
    }

    get text() {
        if (this.internalText === undefined) {
            throw new Error('View node text is not initialized.');
        }
        return this.internalText;
    }

    get style() {
        if (this.internalStyle === undefined) {
            throw new Error('View node style is not initialized.');
        }
        return this.internalStyle;
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

    update(
        text: string,
        width: number,
        height: number,
        paddingTop: number,
        paddingBottom: number,
        paddingLeft: number,
        paddingRight: number,
        style: TStyle,
    ) {
        this.internalText = text;
        this.internalStyle = style;
        this.didUpdateNodeEventEmitter.emit({});
    }
}
