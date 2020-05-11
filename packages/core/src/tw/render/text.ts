import { IFont } from './font';
import { IRenderNode, IRenderNodeType, RenderNode } from './node';

export interface IRenderText<TStyle> extends IRenderNode<TStyle> {
    readonly paddingTop: number;
    readonly paddingBottom: number;
    readonly paddingLeft: number;
    readonly paddingRight: number;
    readonly font: IFont;
}

export abstract class RenderText extends RenderNode<IFont> implements IRenderText<IFont> {
    abstract get paddingTop(): number;
    abstract get paddingBottom(): number;
    abstract get paddingLeft(): number;
    abstract get paddingRight(): number;

    get type(): IRenderNodeType {
        return 'text';
    }

    get root() {
        return false;
    }

    get leaf() {
        return false;
    }

    get padModelSize() {
        return false;
    }

    get modelTextSize() {
        return 0;
    }

    get font() {
        return this.style;
    }
}
