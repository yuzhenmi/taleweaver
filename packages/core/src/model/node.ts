import { Disposable, EventEmitter } from '../event/emitter';
import { EventListener } from '../event/listener';
import { Point } from './point';

export interface DidUpdateModelNodeEvent {}

type Child = ModelNode<any> | string;

export class ModelNode<TAttributes> {
    abstract pointToOffset(point: Point): number;
    abstract offsetToPoint(offset: number): Point;

    protected _attributes: TAttributes;
    protected _children: Child[];
    protected _size: number | null = null;
    protected _needRender = true;

    protected didUpdateEventEmitter = new EventEmitter<DidUpdateModelNodeEvent>();
    protected childDidUpdateDisposableMap: Map<string, Disposable> = new Map();

    constructor(readonly componentId: string, readonly id: string, attributes: TAttributes, children: Child[]) {
        this._attributes = attributes;
        this._children = children;
        this.onDidUpdate(() => {
            this._needRender = true;
        });
        for (const child of children) {
            if (typeof child !== 'string') {
                this.childDidUpdateDisposableMap.set(child.id, child.onDidUpdate(this.handleChildDidUpdate));
            }
        }
    }

    get children(): Readonly<Child[]> {
        return this._children;
    }

    get attributes(): Readonly<TAttributes> {
        return this._attributes;
    }

    get size(): number {
        if (this._size === null) {
            this._size = this._children.reduce((size, child) => {
                if (typeof child === 'string') {
                    return size + 1;
                }
                return size + child.size;
            }, 0);
        }
        return this._size;
    }

    get needRender() {
        return this._needRender;
    }

    setAttributes(attributes: TAttributes) {
        this._attributes = attributes;
        this.didUpdateEventEmitter.emit({});
    }

    markAsRendered() {
        this._needRender = false;
    }

    onDidUpdate(listener: EventListener<DidUpdateModelNodeEvent>) {
        return this.didUpdateEventEmitter.on(listener);
    }

    protected handleChildDidUpdate = () => {
        this.didUpdateEventEmitter.emit({});
    };
}
