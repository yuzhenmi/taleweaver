import { ICursorService } from '../cursor/service';
import { ILayoutRect } from '../layout/rect';
import { ILayoutService } from '../layout/service';
import { IRenderService } from '../render/service';
import { IViewService } from './service';

export interface ICursorView {
    attach(): void;
}

const CURSOR_HUE = 213;

export class CursorView implements ICursorView {
    protected blinkInterval: number | null = null;
    protected blinkState = true;
    protected domCaret: HTMLDivElement;
    protected domSelections: HTMLDivElement[] = [];
    protected attached = false;

    constructor(
        protected instanceId: string,
        protected cursorService: ICursorService,
        protected renderService: IRenderService,
        protected layoutService: ILayoutService,
        protected viewService: IViewService,
    ) {
        this.domCaret = document.createElement('div');
        this.domCaret.className = 'tw--cursor--caret';
        this.domCaret.setAttribute('data-tw-instance', this.instanceId);
        this.domCaret.style.position = 'absolute';
        this.domCaret.style.userSelect = 'none';
        this.domCaret.style.pointerEvents = 'none';
        this.domCaret.style.width = '2px';
        this.domCaret.style.marginLeft = '-1px';
        cursorService.onDidUpdateCursor(this.handleDidUpdateCursorState);
        viewService.onDidUpdateViewState(this.handleDidUpdateViewState);
        viewService.onDidFocus(this.handleDidFocus);
        viewService.onDidBlur(this.handleDidBlur);
    }

    attach() {
        if (this.attached) {
            throw new Error('Already attached to the DOM.');
        }
        this.attached = true;
        this.updateView();
    }

    protected updateView() {
        if (!this.attached) {
            return;
        }
        this.clearDOMSelections();
        const cursorState = this.cursorService.getCursorState();
        const anchor = this.boundCursorPosition(cursorState.anchor);
        const head = this.boundCursorPosition(cursorState.head);
        const from = Math.min(anchor, head);
        const to = Math.max(anchor, head);
        const pageRects = this.layoutService.resolvePageRects(from, to);
        const pageViewNodes = this.viewService.getDocNode().getChildren();
        const focused = this.viewService.isFocused();
        let firstPageOffset: number = -1;
        let firstLayoutRectOffset: number = -1;
        let lastPageOffset: number = -1;
        let lastLayoutRectOffset: number = -1;
        pageRects.forEach((rects, pageOffset) => {
            const pageDOMContentContainer = pageViewNodes[pageOffset].getDOMContentContainer();
            rects.forEach((rect, rectOffset) => {
                if (firstPageOffset < 0) {
                    firstPageOffset = pageOffset;
                    firstLayoutRectOffset = rectOffset;
                }
                lastPageOffset = pageOffset;
                lastLayoutRectOffset = rectOffset;
                if (rect.width === 0) {
                    return;
                }
                const domSelection = this.buildDOMSelection(rect);
                if (focused) {
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
            const rect = pageRects[firstPageOffset][firstLayoutRectOffset];
            headLeft = rect.left;
            headTop = rect.top;
            headHeight = rect.height;
        } else {
            headPageOffset = lastPageOffset;
            const rect = pageRects[lastPageOffset][lastLayoutRectOffset];
            headLeft = rect.left + rect.width;
            headTop = rect.top;
            headHeight = rect.height;
        }
        if (head === anchor) {
            this.domCaret.style.display = 'block';
            this.domCaret.style.top = `${headTop}px`;
            this.domCaret.style.left = `${headLeft}px`;
            this.domCaret.style.height = `${headHeight}px`;
            if (focused) {
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
            this.blinkStop();
            if (focused) {
                this.blinkStart();
            }
        } else {
            this.domCaret.style.display = 'none';
            this.blinkStop();
        }
    }

    protected blinkStart() {
        if (this.blinkInterval !== null) {
            return;
        }
        this.blinkState = true;
        this.blinkInterval = window.setInterval(() => {
            this.blinkState = !this.blinkState;
            this.updateDOMBlink();
        }, 500);
    }

    protected blinkStop() {
        if (this.blinkInterval === null) {
            return;
        }
        this.domCaret.style.visibility = 'visible';
        clearInterval(this.blinkInterval);
        this.blinkInterval = null;
    }

    protected updateDOMBlink() {
        if (this.blinkState) {
            this.domCaret.style.visibility = 'visible';
        } else {
            this.domCaret.style.visibility = 'hidden';
        }
    }

    protected clearDOMSelections() {
        this.domSelections.forEach(domSelection => {
            if (domSelection.parentElement) {
                domSelection.parentElement.removeChild(domSelection);
            }
        });
        this.domSelections = [];
    }

    protected buildDOMSelection(layoutRect: ILayoutRect) {
        const domSelection = document.createElement('div');
        domSelection.className = 'tw--cursor--selection';
        domSelection.setAttribute('data-tw-instance', this.instanceId);
        domSelection.style.position = 'absolute';
        domSelection.style.top = `${layoutRect.top - layoutRect.paddingTop}px`;
        domSelection.style.left = `${layoutRect.left}px`;
        domSelection.style.width = `${layoutRect.paddingLeft + layoutRect.width + layoutRect.paddingRight}px`;
        domSelection.style.height = `${layoutRect.paddingTop + layoutRect.height + layoutRect.paddingBottom}px`;
        domSelection.style.userSelect = 'none';
        domSelection.style.pointerEvents = 'none';
        return domSelection;
    }

    protected boundCursorPosition(offset: number) {
        return Math.min(Math.max(offset, 0), this.renderService.getDocNode().getSize() - 1);
    }

    protected handleDidUpdateCursorState = () => {
        this.updateView();
    };

    protected handleDidUpdateViewState = () => {
        this.updateView();
    };

    protected handleDidFocus = () => {
        this.updateView();
    };

    protected handleDidBlur = () => {
        this.updateView();
    };
}
