import { BaseRenderNode } from './base';

export interface TextStyle {
    weight: number;
    size: number;
    family: string;
    letterSpacing: number;
    underline: boolean;
    italic: boolean;
    strikethrough: boolean;
    color: string;
}

export class TextRenderNode extends BaseRenderNode<TextStyle> {
    readonly type = 'text';

    readonly size: number;

    constructor(id: string, style: TextStyle, readonly content: string) {
        super(id, style);
        this.size = this.content.length;
    }
}
