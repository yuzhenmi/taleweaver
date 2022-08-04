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

    protected internalContent = '';

    constructor() {
        super({
            weight: 400,
            size: 16,
            family: 'sans-serif',
            letterSpacing: 0,
            underline: false,
            italic: false,
            strikethrough: false,
            color: 'black',
        });
    }

    get content() {
        return this.internalContent;
    }

    get size() {
        return this.internalContent.length;
    }

    setContent(content: string) {
        this.internalContent = content;
        this.didUpdateEventEmitter.emit({});
    }
}
