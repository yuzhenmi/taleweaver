import Editor from '../Editor';
import { TextStyle } from '../model/Text';
import getInlineRenderNodesBetween from './utils/getInlineRenderNodesBetween';
import DocRenderNode from './DocRenderNode';
import RenderEngine from './RenderEngine';
import InlineRenderNode from './InlineRenderNode';
import TextInlineRenderNode from './TextInlineRenderNode';
import LineBreakInlineRenderNode from './LineBreakInlineRenderNode';

class RenderManager {
  protected editor: Editor;
  protected docRenderNode: DocRenderNode;
  protected renderEngine: RenderEngine;

  constructor(editor: Editor) {
    this.editor = editor;
    const modelManager = editor.getModelManager();
    const doc = modelManager.getDoc();
    this.docRenderNode = new DocRenderNode(editor, doc.getID());
    this.renderEngine = new RenderEngine(editor, this.docRenderNode);
  }

  getDocRenderNode() {
    return this.docRenderNode;
  }

  getModelOffset(offset: number): number {
    return this.docRenderNode.getModelOffset(offset);
  }

  resolveOffset(offset: number) {
    return this.docRenderNode.resolveOffset(offset);
  }

  getTextStyleBetween(from: number, to: number) {
    const renderNodes = getInlineRenderNodesBetween(this.editor, from, to);
    const textStyles: TextStyle[] = [];
    renderNodes.forEach(renderNode => {
      let textStyle: TextStyle | null = null;
      if (renderNode instanceof TextInlineRenderNode) {
        textStyle = renderNode.getTextStyle();
      }
      if (textStyle) {
        textStyles.push(textStyle);
      }
    });
    if (textStyles.length === 0) {
      return null;
    }
    const mergedTextStyle = textStyles.reduce(
      (mergedTextStyle, textStyle) => this.mergeTextStyles(
        mergedTextStyle,
        textStyle,
      ),
      textStyles[0],
    );
    return mergedTextStyle;
  }

  protected getInlineRenderNodeTextStyle(inlineRenderNode: InlineRenderNode): TextStyle | null {
    if (inlineRenderNode instanceof TextInlineRenderNode) {
      return inlineRenderNode.getTextStyle();
    }
    if (inlineRenderNode instanceof LineBreakInlineRenderNode) {
      const siblings = inlineRenderNode.getParent().getChildren();
      if (siblings.length > 0) {
        return this.getInlineRenderNodeTextStyle(siblings[siblings.length - 1]);
      }
    }
    return null;
  }

  protected mergeTextStyles(textStyle1: TextStyle, textStyle2: TextStyle): TextStyle {
    return {
      weight: this.mergeTextStyleAttributes(textStyle1.weight, textStyle2.weight, null),
      size: this.mergeTextStyleAttributes(textStyle1.size, textStyle2.size, null),
      color: this.mergeTextStyleAttributes(textStyle1.color, textStyle2.color, null),
      font: this.mergeTextStyleAttributes(textStyle1.font, textStyle2.font, null),
      letterSpacing: this.mergeTextStyleAttributes(textStyle1.letterSpacing, textStyle2.letterSpacing, null),
      italic: this.mergeTextStyleAttributes(textStyle1.italic, textStyle2.italic, false),
      underline: this.mergeTextStyleAttributes(textStyle1.underline, textStyle2.underline, false),
      strikethrough: this.mergeTextStyleAttributes(textStyle1.strikethrough, textStyle2.strikethrough, false),
    };
  }

  protected mergeTextStyleAttributes<T>(attribute1: T, attribute2: T, defaultValue: T) {
    if (attribute1 === attribute2) {
      return attribute1;
    }
    return defaultValue;
  }
}

export default RenderManager;
