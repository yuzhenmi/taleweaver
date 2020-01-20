import { EventEmitter, IEventEmitter } from '../event/emitter';
import { IEventListener } from '../event/listener';
import { IViewService } from './service';

export interface IPointerDidDownEvent {
    offset: number;
    consecutive: boolean;
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
    protected lastPointerDown: {
        timestamp: number;
        offset: number;
    } | null = null;
    protected lastClick: {
        timestamp: number;
        offset: number;
    } | null = null;
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
        this.lastPointerDown = {
            timestamp: Date.now(),
            offset,
        };
        const consecutive =
            this.lastClick !== null && Date.now() - this.lastClick.timestamp < this.consecutiveClickThreshold;
        this.pointerDidDownEventEmitter.emit({ offset, consecutive });
    };

    protected handleMouseMove = (event: MouseEvent) => {
        const offset = this.resolveCoordinates(event.clientX, event.clientY);
        if (offset === null) {
            return;
        }
        this.pointerDidMoveEventEmitter.emit({
            pointerDown: this.lastPointerDown !== null,
            offset,
        });
    };

    protected handleMouseUp = (event: MouseEvent) => {
        if (this.lastPointerDown === null) {
            return;
        }
        const lastPointerDown = this.lastPointerDown;
        this.lastPointerDown = null;
        const offset = this.resolveCoordinates(event.clientX, event.clientY);
        if (offset === null) {
            return;
        }
        const now = Date.now();
        const clicked = lastPointerDown.offset === offset && now - lastPointerDown.timestamp < this.clickThreshold;
        this.pointerDidUpEventEmitter.emit({});
        if (clicked) {
            if (this.lastClick !== null) {
                const delta = now - this.lastClick.timestamp;
                if (delta > this.consecutiveClickThreshold) {
                    this.consecutiveClickCount = 0;
                }
            }
            this.consecutiveClickCount++;
            this.lastClick = {
                timestamp: Date.now(),
                offset,
            };
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
