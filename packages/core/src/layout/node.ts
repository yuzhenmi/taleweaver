import { EventEmitter } from '../event/emitter';
import { IEventListener, IOnEvent } from '../event/listener';
import { generateId } from '../util/id';
import { IBlockLayoutNode } from './block-node';
import { IDocLayoutNode } from './doc-node';
import { IInlineLayoutNode } from './inline-node';
import { ILineLayoutNode } from './line-node';
import { IPageLayoutNode } from './page-node';
import { ITextLayoutNode } from './text-node';
import { IWordLayoutNode } from './word-node';

export interface IDidUpdateLayoutNodeEvent {}

export interface IBoundingBox {
    readonly from: number;
    readonly to: number;
    readonly width: number;
    readonly height: number;
    readonly left: number;
    readonly right: number;
    readonly top: number;
    readonly bottom: number;
}

export interface IResolveBoundingBoxesResult {
    readonly node: ILayoutNode;
    readonly boundingBoxes: IBoundingBox[];
    readonly children: IResolveBoundingBoxesResult[];
}

export interface ILayoutPositionLayerDescription<TNode extends ILayoutNode = any> {
    readonly node: TNode;
    readonly position: number;
}

export interface IBaseLayoutNode<TLayoutProps, TLayout> {
    readonly id: string;
    readonly layoutProps: TLayoutProps;
    readonly layout: TLayout;
    readonly size: number;
    readonly needDisplay: boolean;

    setLayoutProps(layoutProps: TLayoutProps): void;
    markAsDisplayed(): void;
    resolveBoundingBoxes(from: number, to: number): IResolveBoundingBoxesResult;
    describePosition(position: number): ILayoutPositionLayerDescription[];
    onDidUpdate: IOnEvent<IDidUpdateLayoutNodeEvent>;
}

export type ILayoutNode =
    | IDocLayoutNode
    | IPageLayoutNode
    | IBlockLayoutNode
    | ILineLayoutNode
    | IInlineLayoutNode
    | ITextLayoutNode
    | IWordLayoutNode;

export type IBoundedLayoutNode = IPageLayoutNode | ILineLayoutNode;

export abstract class BaseLayoutNode<TLayoutProps, TLayout> implements IBaseLayoutNode<TLayoutProps, TLayout> {
    abstract readonly size: number;

    abstract resolveBoundingBoxes(from: number, to: number): IResolveBoundingBoxesResult;

    abstract describePosition(position: number): ILayoutPositionLayerDescription[];

    protected abstract buildLayout(): TLayout;

    readonly id = generateId();

    protected internalLayoutProps?: TLayoutProps;
    protected internalLayout?: TLayout;
    protected internalNeedDisplay = true;
    protected didUpdateEventEmitter = new EventEmitter<IDidUpdateLayoutNodeEvent>();

    constructor() {
        this.onDidUpdate(() => {
            this.internalNeedDisplay = true;
            this.internalLayout = undefined;
        });
    }

    get layoutProps(): TLayoutProps {
        if (!this.internalLayoutProps) {
            throw new Error('Layout props not initialized.');
        }
        return this.internalLayoutProps;
    }

    get layout(): TLayout {
        if (!this.internalLayout) {
            this.internalLayout = this.buildLayout();
        }
        return this.internalLayout;
    }

    get needDisplay() {
        return this.internalNeedDisplay;
    }

    setLayoutProps(layoutProps: TLayoutProps) {
        this.internalLayoutProps = layoutProps;
        this.didUpdateEventEmitter.emit({});
    }

    markAsDisplayed() {
        this.internalNeedDisplay = false;
    }

    onDidUpdate(listener: IEventListener<IDidUpdateLayoutNodeEvent>) {
        return this.didUpdateEventEmitter.on(listener);
    }
}
