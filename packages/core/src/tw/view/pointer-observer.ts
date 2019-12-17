import { EventEmitter, IEventEmitter } from 'tw/event/emitter';
import { IEventListener } from 'tw/event/listener';
import { IViewService } from 'tw/view/service';

export interface IPointerDidDownEvent {
    inPage: boolean;
    position: number;
}

export interface IPointerDidMoveEvent {
    inPage: boolean;
    pointerDown: boolean;
    position: number;
}

export interface IPointerDidUpEvent {}

export interface IPointerObserver {
    onPointerDidDown(listener: IEventListener<IPointerDidDownEvent>): void;
    onPointerDidMove(listener: IEventListener<IPointerDidMoveEvent>): void;
    onPointerDidUp(listener: IEventListener<IPointerDidUpEvent>): void;
}

export class PointerObserver implements IPointerObserver {
    protected pointerDown = false;
    protected pointerDidDownEventEmitter: IEventEmitter<IPointerDidDownEvent> = new EventEmitter();
    protected pointerDidMoveEventEmitter: IEventEmitter<IPointerDidMoveEvent> = new EventEmitter();
    protected pointerDidUpEventEmitter: IEventEmitter<IPointerDidUpEvent> = new EventEmitter();

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

    protected handleMouseDown(event: MouseEvent) {
        const position = this.resolvePosition(event.clientX, event.clientY);
        if (position === null) {
            return;
        }
        this.pointerDidDownEventEmitter.emit({
            inPage: this.isDOMElementInPage(event.target as HTMLElement),
            position,
        });
    }

    protected handleMouseMove(event: MouseEvent) {
        const position = this.resolvePosition(event.clientX, event.clientY);
        if (position === null) {
            return;
        }
        this.pointerDidMoveEventEmitter.emit({
            inPage: this.isDOMElementInPage(event.target as HTMLElement),
            pointerDown: this.pointerDown,
            position,
        });
    }

    protected handleMouseUp() {
        this.pointerDown = false;
        this.pointerDidUpEventEmitter.emit({});
    }

    protected resolvePosition(x: number, y: number): number | null {
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
                const pageDOMContentContainer = pageViewNode.getDOMContentContainer();
                const pageContentBoundingClientRect = pageDOMContentContainer.getBoundingClientRect();
                const pageX = x - pageContentBoundingClientRect.left;
                const pageY = y - pageContentBoundingClientRect.top;
                return cumulatedOffset + pageLayoutNode.convertCoordinatesToOffset(pageX, pageY);
            }
            cumulatedOffset += pageLayoutNode.getSize();
        }
        return null;
    }

    protected isDOMElementInPage(domElement: HTMLElement | null) {
        let current: HTMLElement | null = domElement;
        while (current) {
            const instanceId = current.getAttribute('data-tw-instance');
            const componentId = current.getAttribute('data-tw-component');
            const partId = current.getAttribute('data-tw-part');
            if (instanceId === this.instanceId && componentId === 'page' && partId === 'page') {
                return true;
            }
            current = current.parentElement;
        }
        return false;
    }
}
