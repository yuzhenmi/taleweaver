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

    toDOM(from: number, to: number) {
        const $component = document.createElement('span');
        $component.innerText = this.text.substring(from - 1, to - 1);
        return $component;
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

    get padModelSize() {
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
        return this.textService.applyDefaultFont(this.attributes);
    }

    get font() {
        return this.style;
    }
}

export class ViewText extends AbstractViewText<ITextStyle> {
    readonly domContainer = document.createElement('span');
    readonly domContentContainer = document.createElement('span');

    constructor(
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
    ) {
        super(componentId, renderId, layoutId, text, style);
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
        this.domContentContainer.style.textDecoration = style.strikethrough ? 'line-through' : '';
        this.domContentContainer.innerText = text;
        this.domContainer.appendChild(this.domContentContainer);
    }

    get partId() {
        return 'text';
    }
}

export class TextComponent extends Component implements IComponent {
    constructor(id: string, protected textService: ITextService) {
        super(id);
    }

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
        switch (partId) {
            case 'text':
                return new RenderText(this.id, modelId, this.textService, text, attributes);
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
            case 'doc':
                return new ViewText(
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
                );
            default:
                throw new Error('Invalid part ID.');
        }
    }
}
