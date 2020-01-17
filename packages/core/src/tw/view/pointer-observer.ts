import { EventEmitter, IEventEmitter } from '../event/emitter';
import { IEventListener } from '../event/listener';
import { IViewService } from './service';

export interface IPointerDidDownEvent {
    offset: number;
}

export interface IPointerDidMoveEvent {
    pointerDown: boolean;
    offset: number;
}

export interface IPointerDidUpEvent {}

export interface IPointerDidClick {
    offset: number;
    consecutiveCount: number;
}

export interface IPointerObserver {
    onPointerDidDown(listener: IEventListener<IPointerDidDownEvent>): void;
    onPointerDidMove(listener: IEventListener<IPointerDidMoveEvent>): void;
    onPointerDidUp(listener: IEventListener<IPointerDidUpEvent>): void;
    onPointerDidClick(listener: IEventListener<IPointerDidClick>): void;
}

export class PointerObserver implements IPointerObserver {
    protected clickThreshold = 250;
    protected consecutiveClickThreshold = 250;
    protected pointerDownAt: number | null = null;
    protected clickedAt: number | null = null;
    protected consecutiveClickCount: number = 0;
    protected pointerDidDownEventEmitter: IEventEmitter<IPointerDidDownEvent> = new EventEmitter();
    protected pointerDidMoveEventEmitter: IEventEmitter<IPointerDidMoveEvent> = new EventEmitter();
    protected pointerDidUpEventEmitter: IEventEmitter<IPointerDidUpEvent> = new EventEmitter();
    protected pointerDidClickEventEmitter: IEventEmitter<IPointerDidClick> = new EventEmitter();

    constructor(protected instanceId: string, protected viewService: IViewService) {
        window.addEventListener('mousedown', this.handleMouseDown);
        window.addEventListener('mousemove', this.handleMouseMove);
        window.addEventListener('mouseup', this.handleMouseUp);
    }

    onPointerDidDown(listener: IEventListener<IPointerDidDownEvent>) {
        this.pointerDidDownEventEmitter.on(listener);
    }

    onPointerDidMove(listener: IEventListener<IPointerDidMoveEvent>) {
        this.pointerDidMoveEventEmitter.on(listener);
    }

    onPointerDidUp(listener: IEventListener<IPointerDidUpEvent>) {
        this.pointerDidUpEventEmitter.on(listener);
    }

    onPointerDidClick(listener: IEventListener<IPointerDidClick>) {
        this.pointerDidClickEventEmitter.on(listener);
    }

    protected handleMouseDown = (event: MouseEvent) => {
        const offset = this.resolveCoordinates(event.clientX, event.clientY);
        if (offset === null) {
            return;
        }
        // Bypass browser selection
        event.preventDefault();
        this.pointerDownAt = Date.now();
        if (this.clickedAt === null || Date.now() - this.clickedAt > this.consecutiveClickThreshold) {
            this.pointerDidDownEventEmitter.emit({ offset });
        }
    };

    protected handleMouseMove = (event: MouseEvent) => {
        const offset = this.resolveCoordinates(event.clientX, event.clientY);
        if (offset === null) {
            return;
        }
        this.pointerDidMoveEventEmitter.emit({
            pointerDown: this.pointerDownAt !== null,
            offset,
        });
    };

    protected handleMouseUp = (event: MouseEvent) => {
        if (this.pointerDownAt === null) {
            return;
        }
        const now = Date.now();
        const clicked = now - this.pointerDownAt < this.clickThreshold;
        this.pointerDownAt = null;
        this.pointerDidUpEventEmitter.emit({});
        const offset = this.resolveCoordinates(event.clientX, event.clientY);
        if (offset === null) {
            return;
        }
        if (clicked) {
            if (this.clickedAt !== null) {
                const delta = now - this.clickedAt;
                if (delta > this.consecutiveClickThreshold) {
                    this.consecutiveClickCount = 0;
                }
            }
            this.consecutiveClickCount++;
            this.clickedAt = Date.now();
            this.pointerDidClickEventEmitter.emit({
                offset,
                consecutiveCount: this.consecutiveClickCount,
            });
        }
    };

    protected resolveCoordinates(x: number, y: number): number | null {
        const pageViewNodes = this.viewService.getDocNode().getChildren();
        let cumulatedOffset = 0;
        for (let pageViewNode of pageViewNodes) {
            const pageLayoutNode = pageViewNode.getLayoutNode();
            const pageDOMContainer = pageViewNode.getDOMContainer();
            const pageBoundingClientRect = pageDOMContainer.getBoundingClientRect();
            if (
                pageBoundingClientRect.left <= x &&
                pageBoundingClientRect.right >= x &&
                pageBoundingClientRect.top <= y &&
                pageBoundingClientRect.bottom >= y
            ) {
                const pageX = x - pageBoundingClientRect.left;
                const pageY = y - pageBoundingClientRect.top;
                return cumulatedOffset + pageLayoutNode.convertCoordinatesToOffset(pageX, pageY);
            }
            cumulatedOffset += pageLayoutNode.getSize();
        }
        return null;
    }
}
