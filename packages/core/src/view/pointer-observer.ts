import { IDOMService } from '../dom/service';
import { EventEmitter } from '../event/emitter';
import { IEventListener } from '../event/listener';
import { ILayoutService } from '../layout/service';
import { IViewState } from './state';

export interface IPointerDidDownEvent {
    position: number;
    consecutive: boolean;
}

export interface IPointerDidMoveEvent {
    pointerDown: boolean;
    position: number;
}

export interface IPointerDidUpEvent {}

export interface IPointerDidClick {
    position: number;
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
        position: number;
    } | null = null;
    protected lastClick: {
        timestamp: number;
        position: number;
    } | null = null;
    protected consecutiveClickCount: number = 0;
    protected pointerDidDownEventEmitter = new EventEmitter<IPointerDidDownEvent>();
    protected pointerDidMoveEventEmitter = new EventEmitter<IPointerDidMoveEvent>();
    protected pointerDidUpEventEmitter = new EventEmitter<IPointerDidUpEvent>();
    protected pointerDidClickEventEmitter = new EventEmitter<IPointerDidClick>();

    constructor(
        protected instanceId: string,
        protected viewState: IViewState,
        protected domService: IDOMService,
        protected layoutService: ILayoutService,
    ) {
        const window = domService.getWindow();
        window.addEventListener('mousedown', this.handleMouseDown);
        window.addEventListener('mousemove', this.handleMouseMove);
        window.addEventListener('mouseup', this.handleMouseUp);
    }

    onPointerDidDown(listener: IEventListener<IPointerDidDownEvent>) {
        return this.pointerDidDownEventEmitter.on(listener);
    }

    onPointerDidMove(listener: IEventListener<IPointerDidMoveEvent>) {
        return this.pointerDidMoveEventEmitter.on(listener);
    }

    onPointerDidUp(listener: IEventListener<IPointerDidUpEvent>) {
        return this.pointerDidUpEventEmitter.on(listener);
    }

    onPointerDidClick(listener: IEventListener<IPointerDidClick>) {
        return this.pointerDidClickEventEmitter.on(listener);
    }

    protected handleMouseDown = (event: MouseEvent) => {
        const position = this.getMouseEventPosition(event);
        if (position === null) {
            return;
        }
        // Bypass browser selection
        event.preventDefault();
        this.lastPointerDown = {
            timestamp: Date.now(),
            position,
        };
        const consecutive =
            this.lastClick !== null && Date.now() - this.lastClick.timestamp < this.consecutiveClickThreshold;
        this.pointerDidDownEventEmitter.emit({ position, consecutive });
    };

    protected handleMouseMove = (event: MouseEvent) => {
        const position = this.getMouseEventPosition(event);
        if (position === null) {
            return;
        }
        this.pointerDidMoveEventEmitter.emit({
            pointerDown: this.lastPointerDown !== null,
            position,
        });
    };

    protected handleMouseUp = (event: MouseEvent) => {
        if (this.lastPointerDown === null) {
            return;
        }
        const lastPointerDown = this.lastPointerDown;
        this.lastPointerDown = null;
        const position = this.getMouseEventPosition(event);
        if (position === null) {
            return;
        }
        const now = Date.now();
        const clicked = lastPointerDown.position === position && now - lastPointerDown.timestamp < this.clickThreshold;
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
                position,
            };
            this.pointerDidClickEventEmitter.emit({
                position,
                consecutiveCount: this.consecutiveClickCount,
            });
        }
    };

    protected getMouseEventPosition(event: MouseEvent): number | null {
        const domContainer = this.viewState.domContainer;
        const target = event.target as HTMLElement | null;
        if (!domContainer || !target || !domContainer.contains(target)) {
            return null;
        }
        const x = event.clientX;
        const y = event.clientY;
        const viewDoc = this.viewState.doc;
        const layoutDoc = this.layoutService.getDoc();
        const viewPages = viewDoc.children;
        const layoutPages = layoutDoc.children;
        for (let n = 0, nn = viewPages.length; n < nn; n++) {
            const viewPage = viewPages[n];
            const layoutPage = layoutPages[n];
            const pageBoundingClientRect = viewPage.domContainer.getBoundingClientRect();
            if (
                pageBoundingClientRect.left <= x &&
                pageBoundingClientRect.right >= x &&
                pageBoundingClientRect.top <= y &&
                pageBoundingClientRect.bottom >= y
            ) {
                const pageX = x - pageBoundingClientRect.left;
                const pageY = y - pageBoundingClientRect.top;
                return layoutPage.convertCoordinatesToPosition(pageX, pageY);
            }
        }
        return null;
    }
}
