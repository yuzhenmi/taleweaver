import { ICommandService } from 'tw/command/service';
import { IDidInsertEvent, IKeyboardObserver, KeyboardObserver } from './keyboard-observer';
import { IPointerObserver, PointerObserver } from './pointer-observer';

export interface IDOMController {
    connect(): void;
    requestFocus(): void;
    requestBlur(): void;
    isFocused(): boolean;
}

export class DOMController {
    protected $iframe: HTMLIFrameElement;
    protected $contentEditable: HTMLDivElement;
    protected keyboardObserver: IKeyboardObserver;
    protected pointerObserver: IPointerObserver;
    protected composing: boolean = false;
    protected focused: boolean = false;
    protected mouseDown: boolean = false;

    constructor(protected instanceId: string, protected commandService: ICommandService) {
        this.$iframe = this.createIframe();
        this.$contentEditable = this.createContentEditable();
        this.keyboardObserver = new KeyboardObserver(this.$contentEditable);
        this.keyboardObserver.onDidInsert(this.handleDidInsert);
        this.pointerObserver = new PointerObserver();
    }

    connect() {
        document.body.appendChild(this.$iframe);
        setTimeout(() => {
            this.$iframe.contentDocument!.body.appendChild(this.$contentEditable);
        });
    }

    requestFocus() {
        this.$contentEditable.focus();
    }

    requestBlur() {
        this.$contentEditable.blur();
    }

    isFocused() {
        return this.focused;
    }

    protected handleDidInsert = (event: IDidInsertEvent) => {
        this.commandService.executeCommand('tw.state.insert', event.tokens);
    };

    protected createIframe() {
        const $iframe = document.createElement('iframe');
        $iframe.scrolling = 'no';
        $iframe.src = 'about:blank';
        $iframe.style.width = '0';
        $iframe.style.height = '0';
        $iframe.style.border = 'none';
        $iframe.style.position = 'fixed';
        $iframe.style.zIndex = '-1';
        $iframe.style.opacity = '0';
        $iframe.style.overflow = 'hidden';
        $iframe.style.left = '0';
        $iframe.style.top = '0';
        return $iframe;
    }

    protected createContentEditable() {
        const $contentEditable = document.createElement('div');
        $contentEditable.contentEditable = 'true';
        $contentEditable.style.whiteSpace = 'pre';
        return $contentEditable;
    }
}
