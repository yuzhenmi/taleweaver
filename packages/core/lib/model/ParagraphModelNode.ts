import Editor from '../Editor';
import { Attributes } from '../state/OpenTagToken';
import generateID from '../utils/generateID';
import BlockModelNode from './BlockModelNode';
import { DOMAttributes } from './ModelNode';

interface ParagraphAttributes extends Attributes { }

export default class ParagraphModelNode extends BlockModelNode<ParagraphAttributes> {

    static getDOMNodeNames(): string[] {
        return [
            'P',
            'DIV',
        ];
    }

    static fromDOM(editor: Editor, nodeName: string, attributes: DOMAttributes): ParagraphModelNode | null {
        return new ParagraphModelNode(editor, generateID(), {});
    }

    getType() {
        return 'Paragraph';
    }

    toHTML(from: number, to: number) {
        const $element = document.createElement('p');
        let offset = 1;
        const childNodes = this.getChildNodes();
        for (let n = 0, nn = childNodes.length; n < nn && offset < to; n++) {
            const childNode = childNodes[n];
            const childSize = childNode.getSize();
            const childFrom = Math.max(0, from - offset);
            const childTo = Math.min(childFrom + childSize, to - offset);
            offset += childSize;
            if (childFrom > childSize || childTo < 0) {
                continue;
            }
            const $childElement = childNode.toHTML(childFrom, childTo);
            $element.appendChild($childElement);
        }
        return $element;
    }
}
