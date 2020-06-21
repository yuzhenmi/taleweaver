import { IDOMService } from '../../dom/service';
import { ModelBranch } from '../../model/branch';
import { IModelNode } from '../../model/node';
import { RenderBlock } from '../../render/block';
import { IRenderNode } from '../../render/node';
import { IRenderText, RenderText } from '../../render/text';
import { DEFAULT_FONT } from '../../text/service';
import { ViewBlock } from '../../view/block';
import { IViewNode } from '../../view/node';
import { ViewText } from '../../view/text';
import { Component, IComponent } from '../component';

export interface IParagraphAttributes {}

export interface IParagraphStyle {}

export class ModelParagraph extends ModelBranch<IParagraphAttributes> {
    get partId() {
        return 'paragraph';
    }

    toDOM(from: number, to: number) {
        const $element = document.createElement('p');
        let offset = 1;
        const children = this.children;
        for (let n = 0, nn = children.length; n < nn && offset < to; n++) {
            const childNode = children.at(n);
            const childSize = childNode.size;
            const childFrom = Math.max(0, from - offset);
            const childTo = Math.min(childFrom + childSize, to - offset);
            offset += childSize;
            if (childFrom > childSize || childTo < 0) {
                continue;
            }
            const $childElement = childNode.toDOM(childFrom, childTo);
            $element.appendChild($childElement);
        }
        return $element;
    }
}

export class RenderParagraph extends RenderBlock<IParagraphStyle, IParagraphAttributes> {
    constructor(componentId: string, modelId: string | null, attributes: any, children: IRenderNode<any, any>[]) {
        super(componentId, modelId, attributes, [...children, new RenderParagraphLineBreak(componentId, modelId)]);
    }

    get partId() {
        return 'paragraph';
    }

    get pseudo() {
        return false;
    }

    get paddingTop() {
        return 0;
    }

    get paddingBottom() {
        return 12;
    }

    get paddingLeft() {
        return 0;
    }

    get paddingRight() {
        return 0;
    }

    get style() {
        return {};
    }

    convertOffsetToModelOffset(offset: number): number {
        if (this.size === 1) {
            return this.resolvePosition(0).depth;
        }
        if (offset === this.size - 1) {
            return super.convertOffsetToModelOffset(offset - 1) + 1;
        }
        return super.convertOffsetToModelOffset(offset);
    }

    convertModelOffsetToOffset(modelOffset: number): number {
        if (modelOffset <= this.resolvePosition(0).depth) {
            return 0;
        }
        if (super.convertModelOffsetToOffset(modelOffset - 1) + 1 >= this.size - 1) {
            return this.size - 1;
        }
        return super.convertModelOffsetToOffset(modelOffset);
    }
}

export class RenderParagraphLineBreak extends RenderText<null, null> {
    constructor(readonly componentId: string, readonly paragraphModelId: string | null) {
        super(componentId, `${paragraphModelId}.line-break`, ' ', null);
    }

    get partId() {
        return 'line-break';
    }

    get pseudo() {
        return true;
    }

    get paddingTop() {
        return 0;
    }

    get paddingBottom() {
        return 0;
    }

    get paddingLeft() {
        return 0;
    }

    get paddingRight() {
        return 0;
    }

    get style() {
        return null;
    }

    get font() {
        let node = this.previousSibling;
        while (node) {
            if (node.type === 'text') {
                return (node as IRenderText<any, any>).font;
            }
            node = node.previousSibling;
        }
        return DEFAULT_FONT;
    }
}

export class ViewParagraph extends ViewBlock<IParagraphStyle> {
    constructor(
        domContainer: HTMLElement,
        componentId: string | null,
        renderId: string | null,
        layoutId: string,
        style: IParagraphStyle,
        children: IViewNode<any>[],
        width: number,
        height: number,
        paddingTop: number,
        paddingBottom: number,
        paddingLeft: number,
        paddingRight: number,
        domService: IDOMService,
    ) {
        super(domContainer, componentId, renderId, layoutId, style, children, domService);
        this.domContainer.style.width = `${width}px`;
        this.domContainer.style.height = `${height}px`;
        this.domContainer.style.paddingTop = `${paddingTop}px`;
        this.domContainer.style.paddingBottom = `${paddingBottom}px`;
        this.domContainer.style.paddingLeft = `${paddingLeft}px`;
        this.domContainer.style.paddingRight = `${paddingRight}px`;
        this.domContainer.style.lineHeight = '1em';
        this.domContainer.innerHTML = '';
        children.map((child) => this.domContainer.appendChild(child.domContainer));
    }

    get partId() {
        return 'paragraph';
    }

    get domContentContainer() {
        return this.domContainer;
    }
}

export class ViewParagraphLineBreak extends ViewText<null> {
    constructor(
        domContainer: HTMLElement,
        componentId: string | null,
        renderId: string | null,
        layoutId: string,
        domService: IDOMService,
    ) {
        super(domContainer, componentId, renderId, layoutId, ' ', null, domService);
    }

    get partId() {
        return 'line-break';
    }

    get domContentContainer() {
        return this.domContainer;
    }
}

export class ParagraphComponent extends Component implements IComponent {
    buildModelNode(partId: string | null, id: string, text: string, attributes: any, children: IModelNode<any>[]) {
        return new ModelParagraph(this.id, id, attributes, children);
    }

    buildRenderNode(
        partId: string | null,
        modelId: string,
        text: string,
        attributes: any,
        children: IRenderNode<any, any>[],
    ) {
        switch (partId) {
            case 'paragraph':
                return new RenderParagraph(this.id, modelId, attributes, children);
            default:
                throw new Error('Invalid part ID.');
        }
    }

    buildViewNode(
        domContainer: HTMLElement,
        partId: string | null,
        renderId: string,
        layoutId: string,
        text: string,
        style: any,
        children: IViewNode<any>[],
        width: number,
        height: number,
        paddingTop: number,
        paddingBottom: number,
        paddingLeft: number,
        paddingRight: number,
    ) {
        const domService = this.serviceRegistry.getService('dom');
        switch (partId) {
            case 'paragraph':
                return new ViewParagraph(
                    domContainer,
                    this.id,
                    renderId,
                    layoutId,
                    style,
                    children,
                    width,
                    height,
                    paddingTop,
                    paddingBottom,
                    paddingLeft,
                    paddingRight,
                    domService,
                );
            case 'line-break':
                return new ViewParagraphLineBreak(domContainer, this.id, renderId, layoutId, domService);
            default:
                throw new Error('Invalid part ID.');
        }
    }
}
