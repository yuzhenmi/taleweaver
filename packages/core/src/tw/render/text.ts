import { IFont } from './font';
import { IRenderNode, IRenderNodeType, RenderNode } from './node';

export interface IRenderText<TStyle> extends IRenderNode<TStyle> {
    readonly font: IFont;
}

export abstract class RenderText extends RenderNode<IFont> implements IRenderText<IFont> {
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
