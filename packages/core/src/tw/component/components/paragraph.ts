import { ModelBranch } from '../../model/branch';
import { IModelNode } from '../../model/node';
import { RenderBlock } from '../../render/block';
import { IRenderNode } from '../../render/node';
import { IRenderText, RenderText } from '../../render/text';
import { DEFAULT_FONT } from '../../text/service';
import { ViewAtom } from '../../view/atom';
import { ViewBlock } from '../../view/block';
import { IViewNode } from '../../view/node';
import { Component, IComponent } from '../component';

export interface IParagraphAttributes {}

export interface IParagraphStyle {}

export interface IParagraphLineBreakStyle {}

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

    get padModelSize() {
        return true;
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
}

export class RenderParagraphLineBreak extends RenderText<IParagraphLineBreakStyle, null> {
    constructor(readonly componentId: string, readonly paragraphModelId: string | null) {
        super(componentId, `${paragraphModelId}.line-break`, ' ', null);
    }

    get partId() {
        return 'line-break';
    }

    get padModelSize() {
        return false;
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
        return {};
    }

    get font() {
        let node: IRenderNode<any, any> | null = this;
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
    readonly domContainer = document.createElement('div');

    constructor(
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
    ) {
        super(componentId, renderId, layoutId, style, children);
        this.domContainer.style.width = `${width}px`;
        this.domContainer.style.height = `${height}px`;
        this.domContainer.style.paddingTop = `${paddingTop}px`;
        this.domContainer.style.paddingBottom = `${paddingBottom}px`;
        this.domContainer.style.paddingLeft = `${paddingLeft}px`;
        this.domContainer.style.paddingRight = `${paddingRight}px`;
        this.domContainer.style.lineHeight = '1em';
    }

    get partId() {
        return 'paragraph';
    }

    get domContentContainer() {
        return this.domContainer;
    }
}

export class ViewParagraphLineBreak extends ViewAtom<IParagraphLineBreakStyle> {
    readonly domContainer = document.createElement('div');

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
        switch (partId) {
            case 'paragraph':
                return new ViewParagraph(
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
                );
            case 'line-break':
                return new ViewParagraphLineBreak(this.id, renderId, layoutId, style);
            default:
                throw new Error('Invalid part ID.');
        }
    }
}
