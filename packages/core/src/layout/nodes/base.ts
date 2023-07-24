import { LayoutNode } from '.';
import { EventEmitter } from '../../event/emitter';
import { EventListener } from '../../event/listener';
import { generateId } from '../../util/id';

export interface DidUpdateLayoutNodeEvent {}

export interface BoundingBox {
    readonly from: number;
    readonly to: number;
    readonly width: number;
    readonly height: number;
    readonly left: number;
    readonly right: number;
    readonly top: number;
    readonly bottom: number;
}

export interface ResolveBoundingBoxesResult {
    readonly node: LayoutNode;
    readonly boundingBoxes: BoundingBox[];
    readonly children: ResolveBoundingBoxesResult[];
}

export interface ResolveBoundingBoxesResult {
    readonly node: LayoutNode;
    readonly boundingBoxes: BoundingBox[];
    readonly children: ResolveBoundingBoxesResult[];
}

export interface LayoutPositionLayerDescription<TNode extends LayoutNode = any> {
    readonly node: TNode;
    readonly position: number;
}

export abstract class BaseLayoutNode<TLayoutProps, TLayout> {
    abstract readonly size: number;

    abstract resolveBoundingBoxes(from: number, to: number): ResolveBoundingBoxesResult;

    abstract describePosition(position: number): LayoutPositionLayerDescription[];

    protected abstract buildLayout(): TLayout;

    readonly id = generateId();

    protected internalLayoutProps?: TLayoutProps;
    protected internalLayout?: TLayout;
    protected internalNeedDisplay = true;
    protected didUpdateEventEmitter = new EventEmitter<DidUpdateLayoutNodeEvent>();

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

    onDidUpdate(listener: EventListener<DidUpdateLayoutNodeEvent>) {
        return this.didUpdateEventEmitter.on(listener);
    }
}
