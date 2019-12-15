import { EventEmitter, IEventEmitter } from 'tw/event/emitter';
import { IEventListener } from 'tw/event/listener';

export interface IDidPointerDownEvent {}

export interface IDidPointerMoveEvent {}

export interface IDidPointerUpEvent {}

export interface IPointerObserver {
    onPointerDown(listener: IEventListener<IDidPointerDownEvent>): void;
    onPointerMove(listener: IEventListener<IDidPointerMoveEvent>): void;
    onPointerUp(listener: IEventListener<IDidPointerUpEvent>): void;
}

export class PointerObserver implements IPointerObserver {
    protected didPointerDownEventEmitter: IEventEmitter<IDidPointerDownEvent> = new EventEmitter();
    protected didPointerMoveEventEmitter: IEventEmitter<IDidPointerMoveEvent> = new EventEmitter();
    protected didPointerUpEventEmitter: IEventEmitter<IDidPointerUpEvent> = new EventEmitter();

    constructor() {
        window.addEventListener('mousedown', this.handleMouseDown);
        window.addEventListener('mousemove', this.handleMouseMove);
        window.addEventListener('mouseup', this.handleMouseUp);
    }

    onPointerDown(listener: IEventListener<IDidPointerDownEvent>) {
        this.didPointerDownEventEmitter.on(listener);
    }

    onPointerMove(listener: IEventListener<IDidPointerMoveEvent>) {
        this.didPointerMoveEventEmitter.on(listener);
    }

    onPointerUp(listener: IEventListener<IDidPointerUpEvent>) {
        this.didPointerUpEventEmitter.on(listener);
    }

    protected handleMouseDown(event: MouseEvent) {}

    protected handleMouseMove(event: MouseEvent) {}

    protected handleMouseUp(event: MouseEvent) {}
}
