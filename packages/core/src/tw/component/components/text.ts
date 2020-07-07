import { IDOMService } from '../../dom/service';
import { ModelLeaf } from '../../model/leaf';
import { IModelNode } from '../../model/node';
import { IRenderNode } from '../../render/node';
import { RenderText as AbstractRenderText } from '../../render/text';
import { IFont, ITextService } from '../../text/service';
import { IViewNode } from '../../view/node';
import { ViewText as AbstractViewText } from '../../view/text';
import { Component, IComponent } from '../component';

export interface ITextAttributes {
    weight?: number;
    size?: number;
    font?: string;
    letterSpacing?: number;
    underline?: boolean;
    italic?: boolean;
    strikethrough?: boolean;
    color?: string;
}

export interface ITextStyle extends IFont {}

export class ModelText extends ModelLeaf<ITextAttributes> {
    get partId() {
        return 'text';
    }

    canJoin(node: IModelNode<any>) {
        if (this.componentId !== node.componentId) {
            return false;
        }
        if (this.partId !== node.partId) {
            return false;
        }
        if (JSON.stringify(this.attributes) !== JSON.stringify(node.attributes)) {
            return false;
        }
        return true;
    }
}

export class RenderText extends AbstractRenderText<ITextStyle, ITextAttributes> {
    constructor(
        componentId: string,
        modelId: string | null,
        protected textService: ITextService,
        text: string,
        attributes: any,
    ) {
        super(componentId, modelId, text, attributes);
    }

    get partId() {
        return 'text';
    }

    get pseudo() {
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
        return this.textService.applyDefaultFont(this.attributes);
    }

    get font() {
        return this.style;
    }
}

export class ViewText extends AbstractViewText<ITextStyle> {
    constructor(
        domContainer: HTMLElement,
        componentId: string | null,
        renderId: string | null,
        layoutId: string,
        text: string,
        style: ITextStyle,
        width: number,
        height: number,
        paddingTop: number,
        paddingBottom: number,
        paddingLeft: number,
        paddingRight: number,
        domService: IDOMService,
    ) {
        super(domContainer, componentId, renderId, layoutId, text, style, domService);
        this.domContainer.style.display = 'inline-block';
        this.domContainer.style.whiteSpace = 'pre';
        this.domContainer.style.lineHeight = '1em';
        this.domContainer.style.width = `${width}px`;
        this.domContainer.style.height = `${height}px`;
        this.domContainer.style.paddingTop = `${paddingTop}px`;
        this.domContainer.style.paddingBottom = `${paddingBottom}px`;
        this.domContainer.style.paddingLeft = `${paddingLeft}px`;
        this.domContainer.style.paddingRight = `${paddingRight}px`;
        this.domContainer.style.fontFamily = style.family;
        this.domContainer.style.fontSize = `${style.size}px`;
        this.domContainer.style.letterSpacing = `${style.letterSpacing}px`;
        this.domContainer.style.fontWeight = `${style.weight}`;
        this.domContainer.style.color = style.color;
        this.domContainer.style.textDecoration = style.underline ? 'underline' : '';
        this.domContainer.style.fontStyle = style.italic ? 'italic' : '';
        this.domContainer.innerHTML = '';
        const domContentContainer = this.findOrCreateDOMContentContainer();
        domContentContainer.setAttribute('data-tw-role', 'content-container');
        domContentContainer.style.textDecoration = style.strikethrough ? 'line-through' : '';
        domContentContainer.innerHTML = text;
        this.domContainer.appendChild(domContentContainer);
    }

    get partId() {
        return 'text';
    }

    protected findOrCreateDOMContentContainer() {
        for (let n = 0, nn = this.domContainer.children.length; n < nn; n++) {
            const child = this.domContainer.children[n];
            if (child.getAttribute('data-tw-role') === 'content-container') {
                return child as HTMLSpanElement;
            }
        }
        return this.domService.createElement('span');
    }
}

export class TextComponent extends Component implements IComponent {
    buildModelNode(partId: string | null, id: string, text: string, attributes: any, children: IModelNode<any>[]) {
        return new ModelText(this.id, id, text, attributes);
    }

    buildRenderNode(
        partId: string | null,
        modelId: string,
        text: string,
        attributes: any,
        children: IRenderNode<any, any>[],
    ) {
        const textService = this.serviceRegistry.getService('text');
        switch (partId) {
            case 'text':
                return new RenderText(this.id, modelId, textService, text, attributes);
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
            case 'text':
                return new ViewText(
                    domContainer,
                    this.id,
                    renderId,
                    layoutId,
                    text,
                    style,
                    width,
                    height,
                    paddingTop,
                    paddingBottom,
                    paddingLeft,
                    paddingRight,
                    domService,
                );
            default:
                throw new Error('Invalid part ID.');
        }
    }

    toDOM(partId: string | null, attributes: {}, text: string, children: HTMLElement[]) {
        switch (partId) {
            case 'text': {
                const $element = document.createElement('span');
                $element.innerText = text;
                return $element;
            }
            default:
                throw new Error('Invalid part ID.');
        }
    }
}
