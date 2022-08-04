import { EventEmitter } from '../event/emitter';
import { EventListener } from '../event/listener';

export interface DidCopyEvent {}

export interface DidPasteEvent {
    data: DataTransfer;
}

export class ClipboardObserver implements ClipboardObserver {
    protected didCopyEventEmitter = new EventEmitter<DidCopyEvent>();
    protected didPasteEventEmitter = new EventEmitter<DidPasteEvent>();

    constructor(protected $contentEditable: HTMLDivElement) {
        $contentEditable.addEventListener('copy', this.handleCopy);
        $contentEditable.addEventListener('paste', this.handlePaste);
    }

    onDidCopy(listener: EventListener<DidCopyEvent>) {
        return this.didCopyEventEmitter.on(listener);
    }

    onDidPaste(listener: EventListener<DidPasteEvent>) {
        return this.didPasteEventEmitter.on(listener);
    }

    protected handleCopy = (event: ClipboardEvent) => {
        event.preventDefault();
        this.didCopyEventEmitter.emit({});
    };

    protected handlePaste = (event: ClipboardEvent) => {
        event.preventDefault();
        const data = event.clipboardData;
        if (!data) {
            return;
        }
        this.didPasteEventEmitter.emit({ data });
    };
}
