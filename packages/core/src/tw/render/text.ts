import { IFont } from '../text/service';
import { IRenderNode, IRenderNodeType, RenderNode } from './node';

export interface IRenderText<TStyle, TAttributes> extends IRenderNode<TStyle, TAttributes> {
    readonly paddingTop: number;
    readonly paddingBottom: number;
    readonly paddingLeft: number;
    readonly paddingRight: number;
    readonly font: IFont;
}

export abstract class RenderText<TStyle, TAttributes> extends RenderNode<TStyle, TAttributes>
    implements IRenderText<TStyle, TAttributes> {
    abstract get paddingTop(): number;
    abstract get paddingBottom(): number;
    abstract get paddingLeft(): number;
    abstract get paddingRight(): number;
    abstract get font(): IFont;

    get type(): IRenderNodeType {
        return 'text';
    }

    get root() {
        return false;
    }

    get leaf() {
        return true;
    }

    get padModelSize() {
        return false;
    }

    get modelTextSize() {
        return 0;
    }
}
