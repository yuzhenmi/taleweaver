import { EventEmitter } from '../event/emitter';
import { EventListener } from '../event/listener';

export interface DidFocusEvent {}

export interface DidBlurEvent {}

export class FocusObserver implements FocusObserver {
    protected didFocusEventEmitter = new EventEmitter<DidFocusEvent>();
    protected didBlurEventEmitter = new EventEmitter<DidBlurEvent>();

    constructor(protected $contentEditable: HTMLDivElement) {
        $contentEditable.addEventListener('focus', this.handleFocus);
        $contentEditable.addEventListener('blur', this.handleBlur);
    }

    onDidFocus(listener: EventListener<DidFocusEvent>) {
        return this.didFocusEventEmitter.on(listener);
    }

    onDidBlur(listener: EventListener<DidBlurEvent>) {
        return this.didBlurEventEmitter.on(listener);
    }

    protected handleFocus = () => {
        this.didFocusEventEmitter.emit({});
    };

    protected handleBlur = () => {
        this.didBlurEventEmitter.emit({});
    };
}
