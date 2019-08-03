import * as commands from '../command/commands';
import Editor from '../Editor';
import CursorBlurredEvent from '../events/CursorBlurredEvent';
import CursorFocusedEvent from '../events/CursorFocusedEvent';
import copy from '../helpers/copy';
import paste from '../helpers/paste';
import getKeySignatureFromKeyboardEvent from '../key/utils/getKeySignatureFromKeyboardEvent';
import Token from '../state/Token';

function parseNode(node: Node) {
    if (node.nodeValue) {
        return node.nodeValue.split('');
    }
    const tokens: Token[] = [];
    node.childNodes.forEach(childNode => {
        tokens.push(...parseNode(childNode));
    });
    return tokens;
}

export default class DOMObserver {
    protected editor: Editor;
    protected $iframe: HTMLIFrameElement;
    protected $contentEditable: HTMLDivElement;
    protected mutationObserver: MutationObserver;
    protected isComposing: boolean = false;
    protected isFocused: boolean = false;
    protected isMouseDown: boolean = false;

    constructor(editor: Editor) {
        this.editor = editor;
        this.$iframe = document.createElement('iframe');
        this.$iframe.scrolling = 'no';
        this.$iframe.src = 'about:blank';
        this.$iframe.style.width = '0';
        this.$iframe.style.height = '0';
        this.$iframe.style.border = 'none';
        this.$iframe.style.position = 'fixed';
        this.$iframe.style.zIndex = '-1';
        this.$iframe.style.opacity = '0';
        this.$iframe.style.overflow = 'hidden';
        this.$iframe.style.left = '0';
        this.$iframe.style.top = '0';
        this.$contentEditable = document.createElement('div');
        this.$contentEditable.contentEditable = 'true';
        this.$contentEditable.style.whiteSpace = 'pre';
        this.mutationObserver = new MutationObserver(this.onInput);
    }

    connect() {
        window.addEventListener('mousedown', this.onMouseDown);
        window.addEventListener('mousemove', this.onMouseMove);
        window.addEventListener('mouseup', this.onMouseUp);
        document.body.appendChild(this.$iframe);
        setTimeout(() => {
            this.initContentEditable();
        });
    }

    focus() {
        this.$contentEditable.focus();
    }

    blur() {
        this.$contentEditable.blur();
    }

    getIsFocused() {
        return this.isFocused;
    }

    protected onMouseDown = (event: MouseEvent) => {
        if (!(event.target instanceof HTMLElement)) {
            return;
        }
        // Ignore if target is not in page
        let isInPage = false;
        let currentElement: HTMLElement | null = event.target;
        const instanceID = this.editor.getID();
        while (currentElement) {
            const instance = currentElement.getAttribute('data-tw-instance');
            const role = currentElement.getAttribute('data-tw-role');
            if (instance === instanceID && role === 'page') {
                isInPage = true;
                break;
            }
            currentElement = currentElement.parentElement;
        }
        if (!isInPage) {
            if (this.isFocused) {
                this.blur();
            }
            return;
        }
        // Bypass browser selection
        event.preventDefault();
        if (!this.isFocused) {
            this.focus();
        }
        this.isMouseDown = true;
        const offset = this.resolveScreenPosition(event.clientX, event.clientY);
        if (offset < 0) {
            return;
        }
        this.editor.getDispatcher().dispatchCommand(commands.moveCursorTo(offset));
    }

    protected onMouseMove = (event: MouseEvent) => {
        if (!this.isMouseDown) {
            return;
        }
        const offset = this.resolveScreenPosition(event.clientX, event.clientY);
        if (offset < 0) {
            return;
        }
        this.editor.getDispatcher().dispatchCommand(commands.moveCursorHeadTo(offset));
    }

    protected onMouseUp = (event: MouseEvent) => {
        this.isMouseDown = false;
    }

    protected onKeyDown = (event: KeyboardEvent) => {
        const keySignature = getKeySignatureFromKeyboardEvent(event);
        if (!keySignature) {
            return;
        }
        const handled = this.editor.getDispatcher().dispatchKeyPress(keySignature);
        if (handled) {
            event.preventDefault();
        }
    }

    protected onInput = () => {
        setTimeout(() => {
            if (this.isComposing) {
                return;
            }
            const tokens = this.parseContentEditableValue();
            this.$contentEditable.innerHTML = '';
            if (tokens.length === 0) {
                return;
            }
            const dispatcher = this.editor.getDispatcher();
            dispatcher.dispatchCommand(commands.insert(tokens));
        });
    }

    protected onCompositionStart = () => {
        this.isComposing = true;
    }

    protected onCompositionEnd = () => {
        this.isComposing = false;
    }

    protected onFocused = () => {
        this.isFocused = true;
        this.editor.getDispatcher().dispatch(new CursorFocusedEvent());
    }

    protected onBlurred = () => {
        this.isFocused = false;
        this.editor.getDispatcher().dispatch(new CursorBlurredEvent());
    }

    protected onCopy = (event: ClipboardEvent) => {
        event.preventDefault();
        copy(this.editor);
    }

    protected onPaste = (event: ClipboardEvent) => {
        event.preventDefault();
        const clipboardData = event.clipboardData;
        if (!clipboardData) {
            return;
        }
        paste(this.editor, clipboardData);
    }

    protected resolveScreenPosition(x: number, y: number) {
        const layoutService = this.editor.getLayoutService();
        const viewService = this.editor.getViewService();
        const pageLayoutNodes = layoutService.getPages();
        const pageViewNodes = viewService.getPages();
        let cumulatedOffset = 0;
        for (let n = 0, nn = pageViewNodes.length; n < nn; n++) {
            const pageViewNode = pageViewNodes[n];
            const pageLayoutNode = pageLayoutNodes[n];
            const pageDOMContainer = pageViewNode.getDOMContainer();
            const pageBoundingClientRect = pageDOMContainer.getBoundingClientRect();
            if (
                pageBoundingClientRect.left <= x &&
                pageBoundingClientRect.right >= x &&
                pageBoundingClientRect.top <= y &&
                pageBoundingClientRect.bottom >= y
            ) {
                const pageDOMContentContainer = pageViewNode.getDOMContentContainer();
                const pageContentBoundingClientRect = pageDOMContentContainer.getBoundingClientRect();
                const relativeX = x - pageContentBoundingClientRect.left;
                const relativeY = y - pageContentBoundingClientRect.top;
                return cumulatedOffset + pageLayoutNode.convertCoordinatesToOffset(relativeX, relativeY);
            }
            cumulatedOffset += pageLayoutNode.getSize();
        }
        return -1;
    }

    protected parseContentEditableValue() {
        const tokens: Token[] = [];
        this.$contentEditable.childNodes.forEach(childNode => {
            tokens.push(...parseNode(childNode));
        });
        return tokens;
    }

    protected initContentEditable() {
        this.$iframe.contentDocument!.body.appendChild(this.$contentEditable);
        this.$contentEditable.addEventListener('keydown', this.onKeyDown);
        this.$contentEditable.addEventListener('compositionstart', this.onCompositionStart);
        this.$contentEditable.addEventListener('compositionend', this.onCompositionEnd);
        this.$contentEditable.addEventListener('focus', this.onFocused);
        this.$contentEditable.addEventListener('blur', this.onBlurred);
        this.$contentEditable.addEventListener('copy', this.onCopy);
        this.$contentEditable.addEventListener('paste', this.onPaste);
        this.mutationObserver.observe(this.$contentEditable, {
            subtree: true,
            characterData: true,
            childList: true,
        });
    }
}
