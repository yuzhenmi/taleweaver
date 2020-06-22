import { EventEmitter } from '../event/emitter';
import { IEventListener } from '../event/listener';

export interface IDidCopyEvent {}

export interface IDidPasteEvent {
    data: DataTransfer;
}

export interface IClipboardObserver {
    onDidCopy(listener: IEventListener<IDidCopyEvent>): void;
    onDidPaste(listener: IEventListener<IDidPasteEvent>): void;
}

export class ClipboardObserver implements IClipboardObserver {
    protected didCopyEventEmitter = new EventEmitter<IDidCopyEvent>();
    protected didPasteEventEmitter = new EventEmitter<IDidPasteEvent>();

    constructor(protected $contentEditable: HTMLDivElement) {
        $contentEditable.addEventListener('copy', this.handleCopy);
        $contentEditable.addEventListener('paste', this.handlePaste);
    }

    onDidCopy(listener: IEventListener<IDidCopyEvent>) {
        return this.didCopyEventEmitter.on(listener);
    }

    onDidPaste(listener: IEventListener<IDidPasteEvent>) {
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
