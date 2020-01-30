import { ICommandService } from '../command/service';
import { IEventListener } from '../event/listener';
import { IModelService } from '../model/service';
import { createHiddenIframe } from '../util/dom';
import { ClipboardObserver, IClipboardObserver, IDidCopyEvent, IDidPasteEvent } from './clipboard-observer';
import { FocusObserver, IDidBlurEvent, IDidFocusEvent, IFocusObserver } from './focus-observer';
import {
    ICompositionDidEnd,
    ICompositionDidStart,
    IDidInsertEvent,
    IDidPressKeyEvent,
    IKeyboardObserver,
    KeyboardObserver,
} from './keyboard-observer';
import {
    IPointerDidClick,
    IPointerDidDownEvent,
    IPointerDidMoveEvent,
    IPointerObserver,
    PointerObserver,
} from './pointer-observer';
import { IViewService } from './service';

export interface IDOMController {
    onDidPressKey(listener: IEventListener<IDidPressKeyEvent>): void;
    onDidFocus(listener: IEventListener<IDidFocusEvent>): void;
    onDidBlur(listener: IEventListener<IDidBlurEvent>): void;
    attach(): void;
    requestFocus(): void;
    requestBlur(): void;
    isFocused(): boolean;
    isComposing(): boolean;
}

export class DOMController {
    protected iframe: HTMLIFrameElement;
    protected $contentEditable: HTMLDivElement;
    protected keyboardObserver: IKeyboardObserver;
    protected pointerObserver: IPointerObserver;
    protected focusObserver: IFocusObserver;
    protected clipboardObserver: IClipboardObserver;
    protected focused: boolean = false;
    protected composing: boolean = false;
    protected mouseDown: boolean = false;

    constructor(
        protected instanceId: string,
        protected commandService: ICommandService,
        protected modelService: IModelService,
        protected viewService: IViewService,
    ) {
        this.iframe = createHiddenIframe();
        this.$contentEditable = this.createContentEditable();
        this.keyboardObserver = new KeyboardObserver(this.$contentEditable);
        this.keyboardObserver.onDidInsert(this.handleDidInsert);
        this.keyboardObserver.onCompositionDidStart(this.handleCompositionDidStart);
        this.keyboardObserver.onCompositionDidEnd(this.handleCompositionDidEnd);
        this.pointerObserver = new PointerObserver(instanceId, viewService);
        this.pointerObserver.onPointerDidDown(this.handlePointerDidDown);
        this.pointerObserver.onPointerDidMove(this.handlePointerDidMove);
        this.pointerObserver.onPointerDidClick(this.handlePointerDidClick);
        this.focusObserver = new FocusObserver(this.$contentEditable);
        this.focusObserver.onDidFocus(this.handleDidFocus);
        this.focusObserver.onDidBlur(this.handleDidBlur);
        this.clipboardObserver = new ClipboardObserver(this.$contentEditable);
        this.clipboardObserver.onDidCopy(this.handleCopy);
        this.clipboardObserver.onDidPaste(this.handlePaste);
    }

    onDidPressKey(listener: IEventListener<IDidPressKeyEvent>) {
        this.keyboardObserver.onDidPressKey(listener);
    }

    onDidFocus(listener: IEventListener<IDidFocusEvent>) {
        this.focusObserver.onDidFocus(listener);
    }

    onDidBlur(listener: IEventListener<IDidBlurEvent>) {
        this.focusObserver.onDidBlur(listener);
    }

    attach() {
        document.body.appendChild(this.iframe);
        setTimeout(() => {
            this.iframe.contentDocument!.body.appendChild(this.$contentEditable);
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

    isComposing() {
        return this.composing;
    }

    protected handleDidInsert = (event: IDidInsertEvent) => {
        this.commandService.executeCommand('tw.state.insert', event.tokens);
    };

    protected handleCompositionDidStart = (event: ICompositionDidStart) => {
        this.composing = true;
    };

    protected handleCompositionDidEnd = (event: ICompositionDidEnd) => {
        this.composing = false;
    };

    protected handlePointerDidDown = (event: IPointerDidDownEvent) => {
        if (!this.focused) {
            this.commandService.executeCommand('tw.view.focus');
        }
        if (!event.consecutive) {
            this.commandService.executeCommand('tw.cursor.move', event.offset);
        }
    };

    protected handlePointerDidMove = (event: IPointerDidMoveEvent) => {
        if (event.pointerDown) {
            this.commandService.executeCommand('tw.cursor.moveHead', event.offset);
        }
    };

    protected handlePointerDidClick = (event: IPointerDidClick) => {
        switch (event.consecutiveCount) {
            case 1: {
                break;
            }
            case 2:
                this.commandService.executeCommand('tw.cursor.selectWord', event.offset);
                break;
            case 3:
            default:
                this.commandService.executeCommand('tw.cursor.selectBlock', event.offset);
                break;
        }
    };

    protected handleDidFocus = (event: IDidFocusEvent) => {
        this.focused = true;
    };

    protected handleDidBlur = (event: IDidBlurEvent) => {
        this.focused = false;
    };

    protected handleCopy = (event: IDidCopyEvent) => {
        this.commandService.executeCommand('tw.clipboard.copy');
    };

    protected handlePaste = (event: IDidPasteEvent) => {
        const html = event.data.getData('text/html');
        const $container = document.createElement('html');
        $container.innerHTML = html;
        const $body = $container.querySelector('body');
        if (!$body) {
            return;
        }
        const domNodes = Array.prototype.slice.call($body.children) as HTMLElement[];
        const modelNodes = this.modelService.fromDOM(domNodes);
        // TODO: Insert modelNodes to cursor location
        console.log(modelNodes);
    };

    protected createContentEditable() {
        const $contentEditable = document.createElement('div');
        $contentEditable.contentEditable = 'true';
        $contentEditable.style.whiteSpace = 'pre';
        return $contentEditable;
    }
}
