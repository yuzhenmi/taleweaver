import { CommandService } from '../command/service';
import { DOMService } from '../dom/service';
import { EventListener } from '../event/listener';
import { LayoutService } from '../layout/service';
import { ModelService } from '../model/service';
import { ClipboardObserver, DidCopyEvent, DidPasteEvent } from './clipboard-observer';
import { FocusObserver, DidBlurEvent, DidFocusEvent } from './focus-observer';
import {
    CompositionDidEnd,
    CompositionDidStart,
    DidInsertEvent,
    DidPressKeyEvent,
    KeyboardObserver,
} from './keyboard-observer';
import { PointerDidClick, PointerDidDownEvent, PointerDidMoveEvent, PointerObserver } from './pointer-observer';
import { IViewState } from './state';

export class DOMController {
    protected iframe: HTMLIFrameElement;
    protected $contentEditable: HTMLDivElement;
    protected keyboardObserver: KeyboardObserver;
    protected pointerObserver: PointerObserver;
    protected focusObserver: FocusObserver;
    protected clipboardObserver: ClipboardObserver;
    protected focused: boolean = false;
    protected composing: boolean = false;
    protected mouseDown: boolean = false;

    constructor(
        protected instanceId: string,
        protected viewState: IViewState,
        protected domService: DOMService,
        protected commandService: CommandService,
        protected modelService: ModelService,
        protected layoutService: LayoutService,
    ) {
        this.iframe = domService.createHiddenIframe();
        this.$contentEditable = this.createContentEditable();
        this.keyboardObserver = new KeyboardObserver(this.$contentEditable, domService);
        this.keyboardObserver.onDidInsert(this.handleDidInsert);
        this.keyboardObserver.onCompositionDidStart(this.handleCompositionDidStart);
        this.keyboardObserver.onCompositionDidEnd(this.handleCompositionDidEnd);
        this.pointerObserver = new PointerObserver(instanceId, viewState, domService, layoutService);
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

    onDidPressKey(listener: EventListener<DidPressKeyEvent>) {
        this.keyboardObserver.onDidPressKey(listener);
    }

    onDidFocus(listener: EventListener<DidFocusEvent>) {
        this.focusObserver.onDidFocus(listener);
    }

    onDidBlur(listener: EventListener<DidBlurEvent>) {
        this.focusObserver.onDidBlur(listener);
    }

    attach() {
        this.domService.getBody().appendChild(this.iframe);
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

    protected handleDidInsert = (event: DidInsertEvent) => {
        this.commandService.executeCommand('tw.state.insert', event.content);
    };

    protected handleCompositionDidStart = (event: CompositionDidStart) => {
        this.composing = true;
    };

    protected handleCompositionDidEnd = (event: CompositionDidEnd) => {
        this.composing = false;
    };

    protected handlePointerDidDown = (event: PointerDidDownEvent) => {
        if (!this.focused) {
            this.commandService.executeCommand('tw.view.focus');
        }
        if (!event.consecutive) {
            this.commandService.executeCommand('tw.cursor.move', event.position);
        }
    };

    protected handlePointerDidMove = (event: PointerDidMoveEvent) => {
        if (event.pointerDown) {
            this.commandService.executeCommand('tw.cursor.moveHead', event.position);
        }
    };

    protected handlePointerDidClick = (event: PointerDidClick) => {
        switch (event.consecutiveCount) {
            case 1:
                break;
            case 2:
                this.commandService.executeCommand('tw.cursor.selectWord', event.position);
                break;
            case 3:
                this.commandService.executeCommand('tw.cursor.selectBlock', event.position);
                break;
            case 4:
            default:
                this.commandService.executeCommand('tw.cursor.selectAll');
        }
    };

    protected handleDidFocus = (event: DidFocusEvent) => {
        this.focused = true;
    };

    protected handleDidBlur = (event: DidBlurEvent) => {
        this.focused = false;
    };

    protected handleCopy = (event: DidCopyEvent) => {
        this.commandService.executeCommand('tw.clipboard.copy');
    };

    protected handlePaste = (event: DidPasteEvent) => {
        const html = event.data.getData('text/html');
        const $container = this.domService.createElement('html');
        $container.innerHTML = html;
        const $body = $container.querySelector('body');
        if (!$body) {
            return;
        }
        const domNodes = Array.prototype.slice.call($body.children) as HTMLElement[];
        console.log(domNodes);
        // TODO
    };

    protected createContentEditable() {
        const $contentEditable = this.domService.createElement('div');
        $contentEditable.contentEditable = 'true';
        $contentEditable.style.whiteSpace = 'pre';
        return $contentEditable;
    }
}
