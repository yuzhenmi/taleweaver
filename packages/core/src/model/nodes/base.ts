import { EventEmitter } from '../../event/emitter';
import { EventListener } from '../../event/listener';

export type Path = number[];

export interface Point {
    path: Path;
    offset: number;
}

export interface DidUpdateModelNodeEvent {}

export abstract class BaseModelNode<TAttributes> {
    abstract readonly size: number;

    abstract pointToOffset(point: Point): number;
    abstract offsetToPoint(offset: number): Point;

    protected _attributes: TAttributes;
    protected _needRender = true;
    protected didUpdateEventEmitter = new EventEmitter<DidUpdateModelNodeEvent>();

    constructor(readonly componentId: string, readonly id: string, attributes: TAttributes) {
        this._attributes = attributes;
        this.onDidUpdate(() => {
            this._needRender = true;
        });
    }

    get attributes(): Readonly<TAttributes> {
        return this._attributes;
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
}
