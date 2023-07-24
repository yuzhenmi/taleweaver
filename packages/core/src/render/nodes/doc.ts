import { RenderNode } from '.';
import { BaseRenderNode } from './base';

export interface DocStyle {
    pageWidth: number;
    pageHeight: number;
    pagePaddingTop: number;
    pagePaddingBottom: number;
    pagePaddingLeft: number;
    pagePaddingRight: number;
}

export class DocRenderNode extends BaseRenderNode<DocStyle> {
    readonly type = 'doc';

    readonly size: number;

    constructor(id: string, style: DocStyle, readonly children: RenderNode[]) {
        super(id, style);
        this.size = children.reduce((size, child) => size + child.size, 0);
    }
}
