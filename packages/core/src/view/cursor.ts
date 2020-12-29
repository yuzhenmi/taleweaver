import { IConfigService } from '../config/service';
import { ICursorService } from '../cursor/service';
import { IDOMService } from '../dom/service';
import { IBoundingBox } from '../layout/node';
import { IPageLayoutNode } from '../layout/page-node';
import { ILayoutService } from '../layout/service';
import { IDidApplyTransformationEvent, ITransformService } from '../transform/service';
import { IDidBlurEvent, IDidFocusEvent } from './focus-observer';
import { IPageViewNode } from './node';
import { IViewService } from './service';

export interface ICursorView {
    attach(): void;
}

export class CursorView implements ICursorView {
    protected blinkInterval: number | null = null;
    protected blinkState = true;
    protected caretElement: HTMLDivElement;
    protected selectionElements: HTMLDivElement[] = [];
    protected attached = false;
    protected caretColor: string;
    protected caretInactiveColor: string;
    protected selectionColor: string;
    protected selectionInactiveColor: string;

    constructor(
        protected instanceId: string,
        protected configService: IConfigService,
        protected domService: IDOMService,
        protected cursorService: ICursorService,
        protected layoutService: ILayoutService,
        protected viewService: IViewService,
        protected transformService: ITransformService,
    ) {
        const cursorConfig = configService.getConfig().cursor;
        this.caretColor = cursorConfig.caretColor;
        this.caretInactiveColor = cursorConfig.caretInactiveColor;
        this.selectionColor = cursorConfig.selectionColor;
        this.selectionInactiveColor = cursorConfig.selectionInactiveColor;
        this.caretElement = this.buildCaretElement();
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

    protected buildCaretElement() {
        const caretElement = this.domService.createElement('div');
        caretElement.className = 'tw--cursor--caret';
        caretElement.setAttribute('data-tw-instance', this.instanceId);
        caretElement.style.position = 'absolute';
        caretElement.style.userSelect = 'none';
        caretElement.style.pointerEvents = 'none';
        caretElement.style.width = '2px';
        caretElement.style.marginLeft = '-1px';
        return caretElement;
    }

    protected updateView() {
        if (!this.attached) {
            return;
        }
        this.clearDOMSelections();
        const cursor = this.cursorService.getCursor();
        if (!cursor) {
            return;
        }
        const from = Math.min(cursor.anchor, cursor.head);
        const to = Math.max(cursor.anchor, cursor.head);
        const docBoundingBoxResult = this.layoutService.resolveBoundingBoxes(from, to);
        const docViewNode = this.viewService.getDoc();
        const docLayoutNode = this.layoutService.getDoc();
        const focused = this.viewService.isFocused();
        let firstPageId = '';
        let firstBoxOffset: number = -1;
        let lastPageId = '';
        let lastBoxOffset: number = -1;
        const pageLayoutNodes = docLayoutNode.children;
        const pageViewNodes = docViewNode.children;
        for (const pageBoundingBoxResult of docBoundingBoxResult.children) {
            const pageOffset = pageLayoutNodes.indexOf(pageBoundingBoxResult.node as IPageLayoutNode);
            const pageViewNode = pageViewNodes[pageOffset] as IPageViewNode;
            const domContentContainer = pageViewNode.domContentContainer;
            pageBoundingBoxResult.boundingBoxes.forEach((boundingBox, boundingBoxOffset) => {
                if (!firstPageId) {
                    firstPageId = pageBoundingBoxResult.node.id;
                    firstBoxOffset = boundingBoxOffset;
                }
                lastPageId = pageBoundingBoxResult.node.id;
                lastBoxOffset = boundingBoxOffset;
                if (boundingBox.width === 0) {
                    return;
                }
                const domSelection = this.buildDOMSelection(boundingBox);
                if (focused) {
                    domSelection.style.background = this.selectionColor;
                } else {
                    domSelection.style.background = this.selectionInactiveColor;
                }
                domContentContainer.appendChild(domSelection);
                this.selectionElements.push(domSelection);
            });
        }
        let headPageId: string;
        let headLeft: number;
        let headTop: number;
        let headHeight: number;
        if (cursor.head < cursor.anchor) {
            headPageId = firstPageId;
            const rect = docBoundingBoxResult.children.find((child) => child.node.id === firstPageId)!.boundingBoxes[
                firstBoxOffset
            ];
            headLeft = rect.left;
            headTop = rect.top;
            headHeight = rect.height;
        } else {
            headPageId = lastPageId;
            const rect = docBoundingBoxResult.children.find((child) => child.node.id === lastPageId)!.boundingBoxes[
                lastBoxOffset
            ];
            headLeft = rect.left + rect.width;
            headTop = rect.top;
            headHeight = rect.height;
        }
        if (cursor.head === cursor.anchor) {
            this.caretElement.style.display = 'block';
            this.caretElement.style.top = `${headTop}px`;
            this.caretElement.style.left = `${headLeft}px`;
            this.caretElement.style.height = `${headHeight}px`;
            if (focused) {
                this.caretElement.style.background = this.caretColor;
            } else {
                this.caretElement.style.background = this.caretInactiveColor;
            }
            const pageDOMContentContainer = (docViewNode.children.find(
                (child) => child.layoutId === headPageId,
            ) as IPageViewNode).domContentContainer;
            if (this.caretElement.parentElement && this.caretElement.parentElement !== pageDOMContentContainer) {
                this.caretElement.parentElement.removeChild(this.caretElement);
            }
            if (!this.caretElement.parentElement) {
                pageDOMContentContainer.appendChild(this.caretElement);
            }
            this.blinkStop();
            if (focused) {
                this.blinkStart();
            }
        } else {
            this.caretElement.style.display = 'none';
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
        this.caretElement.style.visibility = 'visible';
        clearInterval(this.blinkInterval);
        this.blinkInterval = null;
    }

    protected updateDOMBlink() {
        if (this.blinkState) {
            this.caretElement.style.visibility = 'visible';
        } else {
            this.caretElement.style.visibility = 'hidden';
        }
    }

    protected clearDOMSelections() {
        this.selectionElements.forEach((domSelection) => {
            if (domSelection.parentElement) {
                domSelection.parentElement.removeChild(domSelection);
            }
        });
        this.selectionElements = [];
    }

    protected buildDOMSelection(boundingBox: IBoundingBox) {
        const domSelection = document.createElement('div');
        domSelection.className = 'tw--cursor--selection';
        domSelection.setAttribute('data-tw-instance', this.instanceId);
        domSelection.style.position = 'absolute';
        domSelection.style.top = `${boundingBox.top}px`;
        domSelection.style.left = `${boundingBox.left}px`;
        domSelection.style.width = `${boundingBox.width}px`;
        domSelection.style.height = `${boundingBox.height}px`;
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
