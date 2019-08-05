import Editor from '../Editor';
import { Attributes } from '../state/OpenTagToken';
import generateID from '../utils/generateID';
import InlineModelNode from './InlineModelNode';
import { DOMAttributes } from './ModelNode';

export interface TextAttributes extends Attributes {
    weight?: number;
    size?: number;
    color?: string;
    font?: string;
    letterSpacing?: number;
    italic?: boolean;
    underline?: boolean;
    strikethrough?: boolean;
}

export default class TextModelNode extends InlineModelNode<TextAttributes> {
    static getDOMNodeNames(): string[] {
        return [
            'SPAN',
        ];
    }

    static fromDOM(editor: Editor, nodeName: string, attributes: DOMAttributes, content: string): TextModelNode | null {
        const text = new TextModelNode(editor, generateID(), {});
        text.setContent(content);
        return text;
    }

    getType() {
        return 'Text';
    }

    toHTML(from: number, to: number) {
        const $element = document.createElement('span');
        $element.innerText = this.content.substring(from - 1, to - 1);
        return $element;
    }
}
