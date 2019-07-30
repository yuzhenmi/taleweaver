import Editor from '../Editor';
import TextModelNode from '../model/TextModelNode';
import InlineRenderNode from './InlineRenderNode';
import TextStyle from './TextStyle';
import TextWordRenderNode from './TextWordRenderNode';
import breakTextToWorkds from './utils/breakTextToWords';

export default class TextRenderNode extends InlineRenderNode {
    protected textStyle: TextStyle;

    constructor(editor: Editor, modelNode: TextModelNode) {
        super(editor, modelNode.getID());
        const textConfig = this.editor.getConfig().getTextConfig();
        const defaultTextStyle = textConfig.getDefaultStyle();
        const attributes = modelNode.getAttributes();
        this.textStyle = {
            weight: attributes.weight || defaultTextStyle.weight,
            size: attributes.size || defaultTextStyle.size,
            color: attributes.color || defaultTextStyle.color,
            font: attributes.font || defaultTextStyle.font,
            letterSpacing: attributes.letterSpacing || defaultTextStyle.letterSpacing,
            italic: attributes.italic || defaultTextStyle.italic,
            underline: attributes.underline || defaultTextStyle.underline,
            strikethrough: attributes.strikethrough || defaultTextStyle.strikethrough,
        };
        const words = breakTextToWorkds(modelNode.getContent());
        words.forEach((word, wordIndex) => {
            const childNode = new TextWordRenderNode(editor, modelNode, wordIndex, this.textStyle, word);
            this.appendChild(childNode);
        });
    }

    getType(): string {
        return 'Text';
    }

    getTextStyle() {
        return this.textStyle;
    }
}
