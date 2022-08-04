import { DOMService } from '../dom/service';
import { EventEmitter } from '../event/emitter';
import { EventListener } from '../event/listener';
import { detectPlatform } from '../util/platform';

export interface DidInsertEvent {
    content: string;
}

export interface DidPressKeyEvent {
    key: string;
    originalKeyboardEvent: KeyboardEvent;
}

export interface CompositionDidStart {}

export interface CompositionDidEnd {}

export class KeyboardObserver {
    protected composing: boolean = false;
    protected mutationObserver: MutationObserver;
    protected didInsertEventEmitter = new EventEmitter<DidInsertEvent>();
    protected didPressKeyEventEmitter = new EventEmitter<DidPressKeyEvent>();
    protected compositionDidStartEventEmitter = new EventEmitter<CompositionDidStart>();
    protected compositionDidEndEventEmitter = new EventEmitter<CompositionDidEnd>();
    protected keyInterpreter = new KeyInterpreter();

    constructor(protected $contentEditable: HTMLDivElement, protected domService: DOMService) {
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

    onDidInsert(listener: EventListener<DidInsertEvent>) {
        return this.didInsertEventEmitter.on(listener);
    }

    onDidPressKey(listener: EventListener<DidPressKeyEvent>) {
        return this.didPressKeyEventEmitter.on(listener);
    }

    onCompositionDidStart(listener: EventListener<CompositionDidStart>) {
        return this.compositionDidStartEventEmitter.on(listener);
    }

    onCompositionDidEnd(listener: EventListener<CompositionDidEnd>) {
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
        this.didPressKeyEventEmitter.emit({
            key,
            originalKeyboardEvent: event,
        });
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
