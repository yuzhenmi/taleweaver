import { IDOMService } from '../dom/service';
import { EventEmitter } from '../event/emitter';
import { IEventListener } from '../event/listener';
import { detectPlatform } from '../util/platform';

export interface IDidInsertEvent {
    content: string;
}

export interface IDidPressKeyEvent {
    key: string;
    originalKeyboardEvent: KeyboardEvent;
}

export interface ICompositionDidStart {}

export interface ICompositionDidEnd {}

export interface IKeyboardObserver {
    onDidInsert(listener: IEventListener<IDidInsertEvent>): void;
    onDidPressKey(listener: IEventListener<IDidPressKeyEvent>): void;
    onCompositionDidStart(listener: IEventListener<ICompositionDidStart>): void;
    onCompositionDidEnd(listener: IEventListener<ICompositionDidEnd>): void;
}

export class KeyboardObserver implements IKeyboardObserver {
    protected composing: boolean = false;
    protected mutationObserver: MutationObserver;
    protected didInsertEventEmitter = new EventEmitter<IDidInsertEvent>();
    protected didPressKeyEventEmitter = new EventEmitter<IDidPressKeyEvent>();
    protected compositionDidStartEventEmitter = new EventEmitter<ICompositionDidStart>();
    protected compositionDidEndEventEmitter = new EventEmitter<ICompositionDidEnd>();
    protected keyInterpreter = new KeyInterpreter();

    constructor(protected $contentEditable: HTMLDivElement, protected domService: IDOMService) {
        this.mutationObserver = domService.createMutationObserver(this.handleDidMutate);
        $contentEditable.addEventListener('keydown', this.handleKeyDown);
        $contentEditable.addEventListener('compositionstart', this.handleCompositionStart);
        $contentEditable.addEventListener('compositionend', this.handleCompositionEnd);
        this.mutationObserver.observe($contentEditable, {
            subtree: true,
            characterData: true,
            childList: true,
        });
    }

    onDidInsert(listener: IEventListener<IDidInsertEvent>) {
        return this.didInsertEventEmitter.on(listener);
    }

    onDidPressKey(listener: IEventListener<IDidPressKeyEvent>) {
        return this.didPressKeyEventEmitter.on(listener);
    }

    onCompositionDidStart(listener: IEventListener<ICompositionDidStart>) {
        return this.compositionDidStartEventEmitter.on(listener);
    }

    onCompositionDidEnd(listener: IEventListener<ICompositionDidEnd>) {
        return this.compositionDidEndEventEmitter.on(listener);
    }

    protected handleDidMutate = () => {
        setTimeout(() => {
            if (this.composing) {
                return;
            }
            const content = this.$contentEditable.innerText;
            this.$contentEditable.innerHTML = '';
            if (content.length === 0) {
                return;
            }
            this.didInsertEventEmitter.emit({ content });
        });
    };

    protected handleKeyDown = (event: KeyboardEvent) => {
        const key = this.keyInterpreter.interpretFromKeyboardEvent(event);
        if (!key) {
            return;
        }
        this.didPressKeyEventEmitter.emit({ key, originalKeyboardEvent: event });
    };

    protected handleCompositionStart = () => {
        this.composing = true;
    };

    protected handleCompositionEnd = () => {
        this.composing = true;
    };
}

class KeyInterpreter {
    interpretFromKeyboardEvent(event: KeyboardEvent) {
        let key: string;
        switch (event.key) {
            case 'Control':
            case 'Shift':
            case 'Alt':
            case 'Meta':
                return undefined;
            case 'ArrowLeft':
                key = 'left';
                break;
            case 'ArrowRight':
                key = 'right';
                break;
            case 'ArrowUp':
                key = 'up';
                break;
            case 'ArrowDown':
                key = 'down';
                break;
            default:
                key = event.key.toLowerCase();
        }
        if (event.metaKey) {
            switch (detectPlatform()) {
                case 'macOS':
                    key = `cmd+${key}`;
                    break;
                case 'Windows':
                    key = `win+${key}`;
                    break;
                case 'Linux':
                default:
                    key = `meta+${key}`;
            }
        }
        if (event.altKey) {
            key = `alt+${key}`;
        }
        if (event.shiftKey) {
            key = `shift+${key}`;
        }
        if (event.ctrlKey) {
            key = `ctrl+${key}`;
        }
        return key;
    }
}
