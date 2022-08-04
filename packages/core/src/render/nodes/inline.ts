import { BaseRenderNode } from './base';

export interface InlineStyle {
    readonly width: number;
    readonly height: number;
}

export class InlineRenderNode extends BaseRenderNode<InlineStyle> {
    readonly type = 'inline';
    readonly size = 1;

    constructor(readonly modelId: string) {
        super({
            width: 0,
            height: 0,
        });
    }
}
