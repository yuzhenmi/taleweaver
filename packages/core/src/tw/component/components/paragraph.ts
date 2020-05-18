import { ModelBranch } from '../../model/branch';
import { RenderAtom } from '../../render/atom';
import { RenderBlock } from '../../render/block';
import { IRenderNode } from '../../render/node';
import { NodeList } from '../../tree/node-list';
import { ViewAtom } from '../../view/atom';
import { ViewBlock } from '../../view/block';
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
    constructor(componentId: string, modelId: string | null) {
        super(componentId, modelId);
        this.onDidSetChildren(() => {
            const children = this.children.map((child) => child);
            this.internalChildren = new NodeList<IRenderNode<any, any>>([...children, this.buildLineBreakNode()]);
        });
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

    protected buildLineBreakNode() {
        return new RenderParagraphLineBreak(this.componentId, `${this.id}.line-break`);
    }
}

export class RenderParagraphLineBreak extends RenderAtom<IParagraphLineBreakStyle, null> {
    get partId() {
        return 'line-break';
    }

    get padModelSize() {
        return false;
    }

    get width() {
        return 0;
    }

    get height() {
        return 0;
    }

    get style() {
        return {};
    }
}

export class ViewParagraph extends ViewBlock<IParagraphStyle> {
    readonly domContainer = document.createElement('div');

    get partId() {
        return 'paragraph';
    }

    get domContentContainer() {
        return this.domContainer;
    }

    update(
        text: string,
        width: number,
        height: number,
        paddingTop: number,
        paddingBottom: number,
        paddingLeft: number,
        paddingRight: number,
        style: IParagraphStyle,
    ) {
        this.domContainer.style.width = `${width}px`;
        this.domContainer.style.height = `${height}px`;
        this.domContainer.style.paddingTop = `${paddingTop}px`;
        this.domContainer.style.paddingBottom = `${paddingBottom}px`;
        this.domContainer.style.paddingLeft = `${paddingLeft}px`;
        this.domContainer.style.paddingRight = `${paddingRight}px`;
        this.domContainer.style.lineHeight = '1em';
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
    buildModelNode(partId: string | null, id: string, text: string, attributes: any) {
        return new ModelParagraph(this.id, id, '', attributes);
    }

    buildRenderNode(partId: string | null, modelId: string) {
        switch (partId) {
            case 'paragraph':
                return new RenderParagraph(this.id, modelId);
            default:
                throw new Error('Invalid part ID.');
        }
    }

    buildViewNode(partId: string | null, renderId: string, layoutId: string) {
        switch (partId) {
            case 'paragraph':
                return new ViewParagraph(this.id, renderId, layoutId);
            case 'line-break':
                return new ViewParagraphLineBreak(this.id, renderId, layoutId);
            default:
                throw new Error('Invalid part ID.');
        }
    }
}
