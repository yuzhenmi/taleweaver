import Editor from '../Editor';
import CursorBlurredEvent from '../events/CursorBlurredEvent';
import CursorFocusedEvent from '../events/CursorFocusedEvent';
import CursorUpdatedEvent from '../events/CursorUpdatedEvent';
import ViewUpdatedEvent from '../events/ViewUpdatedEvent';

const CURSOR_HUE = 213;

export default class CursorView {
    protected editor: Editor;
    protected leftAnchor: number | null;
    protected blinkState: boolean;
    protected blinkInterval: number | null;
    protected domCaret: HTMLDivElement;
    protected domSelections: HTMLDivElement[];

    constructor(editor: Editor) {
        this.editor = editor;
        this.leftAnchor = null;
        this.blinkState = false;
        this.blinkInterval = null;
        this.domCaret = document.createElement('div');
        this.domCaret.className = 'tw--cursor-caret';
        this.domCaret.style.position = 'absolute';
        this.domCaret.style.userSelect = 'none';
        this.domCaret.style.pointerEvents = 'none';
        this.domCaret.style.width = '2px';
        this.domCaret.style.marginLeft = '-1px';
        this.domSelections = [];
        editor.getDispatcher().on(CursorUpdatedEvent, event => this.updateView());
        editor.getDispatcher().on(ViewUpdatedEvent, event => this.updateView());
        editor.getDispatcher().on(CursorFocusedEvent, event => this.updateView());
        editor.getDispatcher().on(CursorBlurredEvent, event => this.updateView());
    }

    getLeftAnchor() {
        return this.leftAnchor;
    }

    protected startBlinking() {
        if (this.blinkInterval !== null) {
            return;
        }
        this.blinkInterval = setInterval(() => {
            if (this.blinkState) {
                this.domCaret.style.visibility = 'hidden';
            } else {
                this.domCaret.style.visibility = 'visible';
            }
            this.blinkState = !this.blinkState;
        }, 500);
    }

    protected stopBlinking() {
        if (this.blinkInterval === null) {
            return;
        }
        this.blinkState = true;
        this.domCaret.style.visibility = 'visible';
        clearInterval(this.blinkInterval);
        this.blinkInterval = null;
    }

    protected updateView() {
        const cursorService = this.editor.getCursorService();
        const renderService = this.editor.getRenderService();
        const layoutService = this.editor.getLayoutService();
        const viewService = this.editor.getViewService();
        const isFocused = viewService.getIsFocused();
        const docRenderSize = renderService.getDocSize();
        const pageViewNodes = viewService.getPages();

        // Clear dom selections
        while (this.domSelections.length > 0) {
            const domSelection = this.domSelections[0];
            if (domSelection.parentElement) {
                domSelection.parentElement.removeChild(domSelection);
            }
            this.domSelections.splice(0, 1);
        }
        // Render cursor caret and selections
        const anchor = Math.min(Math.max(cursorService.getAnchor(), 0), docRenderSize - 1);
        const head = Math.min(Math.max(cursorService.getHead(), 0), docRenderSize - 1);
        const layoutRectsByPage = layoutService.resolveRects(Math.min(anchor, head), Math.max(anchor, head));
        let firstPageOffset: number = -1;
        let firstLayoutRectOffset: number = -1;
        let lastPageOffset: number = -1;
        let lastLayoutRectOffset: number = -1;
        layoutRectsByPage.forEach((layoutRects, pageOffset) => {
            const pageDOMContentContainer = pageViewNodes[pageOffset].getDOMContentContainer();
            layoutRects.forEach((layoutRect, layoutRectOffset) => {
                if (firstPageOffset < 0) {
                    firstPageOffset = pageOffset;
                    firstLayoutRectOffset = layoutRectOffset;
                }
                lastPageOffset = pageOffset;
                lastLayoutRectOffset = layoutRectOffset;
                if (layoutRect.width === 0) {
                    return;
                }
                const domSelection = document.createElement('div');
                domSelection.className = 'tw--cursor-selection';
                domSelection.style.position = 'absolute';
                domSelection.style.top = `${layoutRect.top - layoutRect.paddingTop}px`;
                domSelection.style.left = `${layoutRect.left}px`;
                domSelection.style.width = `${layoutRect.paddingLeft + layoutRect.width + layoutRect.paddingRight}px`;
                domSelection.style.height = `${layoutRect.paddingTop + layoutRect.height + layoutRect.paddingBottom}px`;
                domSelection.style.userSelect = 'none';
                domSelection.style.pointerEvents = 'none';
                if (isFocused) {
                    domSelection.style.background = `hsla(${CURSOR_HUE}, 100%, 50%, 0.2)`;
                } else {
                    domSelection.style.background = 'hsla(0, 0%, 0%, 0.08)';
                }
                pageDOMContentContainer.appendChild(domSelection);
                this.domSelections.push(domSelection);
            });
        });
        let headPageOffset: number;
        let headLeft: number;
        let headTop: number;
        let headHeight: number;
        if (head < anchor) {
            headPageOffset = firstPageOffset;
            const layoutRect = layoutRectsByPage[firstPageOffset][firstLayoutRectOffset];
            headLeft = layoutRect.left;
            headTop = layoutRect.top;
            headHeight = layoutRect.height;
        } else {
            headPageOffset = lastPageOffset;
            const layoutRect = layoutRectsByPage[lastPageOffset][lastLayoutRectOffset];
            headLeft = layoutRect.left + layoutRect.width;
            headTop = layoutRect.top;
            headHeight = layoutRect.height;
        }
        if (head === anchor) {
            this.domCaret.style.display = 'block';
            this.domCaret.style.top = `${headTop}px`;
            this.domCaret.style.left = `${headLeft}px`;
            this.domCaret.style.height = `${headHeight}px`;
            if (isFocused) {
                this.domCaret.style.background = `hsla(${CURSOR_HUE}, 100%, 50%, 1)`;
            } else {
                this.domCaret.style.background = 'hsla(0, 0%, 0%, 0.5)';
            }
            const pageDOMContentContainer = pageViewNodes[headPageOffset].getDOMContentContainer();
            if (this.domCaret.parentElement && this.domCaret.parentElement !== pageDOMContentContainer) {
                this.domCaret.parentElement.removeChild(this.domCaret);
            }
            if (!this.domCaret.parentElement) {
                pageDOMContentContainer.appendChild(this.domCaret);
            }
            // Reset blinking
            this.stopBlinking();
            if (isFocused) {
                this.startBlinking();
            }
        } else {
            this.domCaret.style.display = 'none';
            this.stopBlinking();
        }
    }
}
