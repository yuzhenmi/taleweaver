import { ICursorService } from '../cursor/service';
import { IDOMService } from '../dom/service';
import { IBoundingBox } from '../layout/node';
import { ILayoutService } from '../layout/service';
import { IDidApplyTransformationEvent, ITransformService } from '../transform/service';
import { IDidBlurEvent, IDidFocusEvent } from './focus-observer';
import { IViewPage } from './page';
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
        protected domService: IDOMService,
        protected cursorService: ICursorService,
        protected layoutService: ILayoutService,
        protected viewService: IViewService,
        protected transformService: ITransformService,
    ) {
        this.domCaret = domService.createElement('div');
        this.domCaret.className = 'tw--cursor--caret';
        this.domCaret.setAttribute('data-tw-instance', this.instanceId);
        this.domCaret.style.position = 'absolute';
        this.domCaret.style.userSelect = 'none';
        this.domCaret.style.pointerEvents = 'none';
        this.domCaret.style.width = '2px';
        this.domCaret.style.marginLeft = '-1px';
        transformService.onDidApplyTransformation((event) => this.handleDidApplyTransformation(event));
        viewService.onDidFocus((event) => this.handleDidFocus(event));
        viewService.onDidBlur((event) => this.handleDidBlur(event));
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
        const { anchor, head } = this.cursorService.getCursor();
        const from = Math.min(anchor, head);
        const to = Math.max(anchor, head);
        const docBoxResult = this.layoutService.resolveBoundingBoxes(from, to);
        const viewDoc = this.viewService.getDoc();
        const layoutDoc = this.layoutService.getDoc();
        const focused = this.viewService.isFocused();
        let firstPageOffset: number = -1;
        let firstBoxOffset: number = -1;
        let lastPageOffset: number = -1;
        let lastBoxOffset: number = -1;
        docBoxResult.children.forEach((pageBoxResult) => {
            const pageOffset = layoutDoc.children.indexOf(pageBoxResult.node);
            const viewPage = viewDoc.children.at(pageOffset) as IViewPage;
            const domContentContainer = viewPage.domContentContainer;
            pageBoxResult.boundingBoxes.forEach((box, boxOffset) => {
                if (firstPageOffset < 0) {
                    firstPageOffset = pageOffset;
                    firstBoxOffset = boxOffset;
                }
                lastPageOffset = pageOffset;
                lastBoxOffset = boxOffset;
                if (box.width === 0) {
                    return;
                }
                const domSelection = this.buildDOMSelection(box);
                if (focused) {
                    domSelection.style.background = `hsla(${CURSOR_HUE}, 100%, 50%, 0.2)`;
                } else {
                    domSelection.style.background = 'hsla(0, 0%, 0%, 0.08)';
                }
                domContentContainer.appendChild(domSelection);
                this.domSelections.push(domSelection);
            });
        });
        let headPageOffset: number;
        let headLeft: number;
        let headTop: number;
        let headHeight: number;
        if (head < anchor) {
            headPageOffset = firstPageOffset;
            const rect = docBoxResult.children[firstPageOffset].boundingBoxes[firstBoxOffset];
            headLeft = rect.left;
            headTop = rect.top;
            headHeight = rect.height;
        } else {
            headPageOffset = lastPageOffset;
            const rect = docBoxResult.children[lastPageOffset].boundingBoxes[lastBoxOffset];
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
            const pageDOMContentContainer = (viewDoc.children.at(headPageOffset) as IViewPage).domContentContainer;
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
        this.domSelections.forEach((domSelection) => {
            if (domSelection.parentElement) {
                domSelection.parentElement.removeChild(domSelection);
            }
        });
        this.domSelections = [];
    }

    protected buildDOMSelection(box: IBoundingBox) {
        const domSelection = document.createElement('div');
        domSelection.className = 'tw--cursor--selection';
        domSelection.setAttribute('data-tw-instance', this.instanceId);
        domSelection.style.position = 'absolute';
        domSelection.style.top = `${box.top}px`;
        domSelection.style.left = `${box.left}px`;
        domSelection.style.width = `${box.width}px`;
        domSelection.style.height = `${box.height}px`;
        domSelection.style.userSelect = 'none';
        domSelection.style.pointerEvents = 'none';
        return domSelection;
    }

    protected handleDidApplyTransformation(event: IDidApplyTransformationEvent) {
        this.updateView();
    }

    protected handleDidFocus(event: IDidFocusEvent) {
        this.updateView();
    }

    protected handleDidBlur(event: IDidBlurEvent) {
        this.updateView();
    }
}
