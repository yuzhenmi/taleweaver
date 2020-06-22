import { EventEmitter } from '../event/emitter';
import { IEventListener } from '../event/listener';

export interface IDidFocusEvent {}

export interface IDidBlurEvent {}

export interface IFocusObserver {
    onDidFocus(listener: IEventListener<IDidFocusEvent>): void;
    onDidBlur(listener: IEventListener<IDidBlurEvent>): void;
}

export class FocusObserver implements IFocusObserver {
    protected didFocusEventEmitter = new EventEmitter<IDidFocusEvent>();
    protected didBlurEventEmitter = new EventEmitter<IDidBlurEvent>();

    constructor(protected $contentEditable: HTMLDivElement) {
        $contentEditable.addEventListener('focus', this.handleFocus);
        $contentEditable.addEventListener('blur', this.handleBlur);
    }

    onDidFocus(listener: IEventListener<IDidFocusEvent>) {
        return this.didFocusEventEmitter.on(listener);
    }

    onDidBlur(listener: IEventListener<IDidBlurEvent>) {
        return this.didBlurEventEmitter.on(listener);
    }

    protected handleFocus = () => {
        this.didFocusEventEmitter.emit({});
    };

    protected handleBlur = () => {
        this.didBlurEventEmitter.emit({});
    };
}
