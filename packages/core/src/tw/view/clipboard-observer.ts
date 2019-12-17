import { EventEmitter, IEventEmitter } from 'tw/event/emitter';
import { IEventListener } from 'tw/event/listener';

export interface IDidCopyEvent {}

export interface IDidPasteEvent {
    data: string;
}

export interface IClipboardObserver {
    onDidCopy(listener: IEventListener<IDidCopyEvent>): void;
    onDidPaste(listener: IEventListener<IDidPasteEvent>): void;
}

export class ClipboardObserver implements IClipboardObserver {
    protected didCopyEventEmitter: IEventEmitter<IDidCopyEvent> = new EventEmitter();
    protected didPasteEventEmitter: IEventEmitter<IDidPasteEvent> = new EventEmitter();

    constructor(protected $contentEditable: HTMLDivElement) {
        $contentEditable.addEventListener('copy', this.handleCopy);
        $contentEditable.addEventListener('paste', this.handlePaste);
    }

    onDidCopy(listener: IEventListener<IDidCopyEvent>) {
        this.didCopyEventEmitter.on(listener);
    }

    onDidPaste(listener: IEventListener<IDidPasteEvent>) {
        this.didPasteEventEmitter.on(listener);
    }

    protected handleCopy(event: ClipboardEvent) {
        this.didCopyEventEmitter.emit({});
    }

    protected handlePaste(event: ClipboardEvent) {
        this.didCopyEventEmitter.emit({ data: event.clipboardData });
    }
}
