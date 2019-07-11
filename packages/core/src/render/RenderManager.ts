import Editor from '../Editor';
import { TextStyle } from '../model/TextModelNode';
import DocRenderNode from './DocRenderNode';
import InlineRenderNode from './InlineRenderNode';
import LineBreakInlineRenderNode from './LineBreakInlineRenderNode';
import RenderEngine from './RenderEngine';
import RenderNode, { ResolvedPosition } from './RenderNode';
import TextInlineRenderNode from './TextInlineRenderNode';

function getLeafPosition(position: ResolvedPosition): ResolvedPosition {
  if (!position.child) {
    return position
  }
  return getLeafPosition(position.child);
}

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

  convertSelectableOffsetToModelOffset(selectableOffset: number): number {
    return this.docRenderNode.convertSelectableOffsetToModelOffset(selectableOffset);
  }

  resolveSelectableOffset(selectableOffset: number) {
    return this.docRenderNode.resolveSelectableOffset(selectableOffset);
  }

  getTextStyleBetween(from: number, to: number) {
    const _from = from;
    const _to = to;
    from = Math.min(_from, _to);
    to = Math.max(_from, _to);
    if (from < to) {
      to--;
    } else if (from > to) {
      from--;
    }
    const renderManager = this.editor.getRenderManager();
    let fromInlineRenderNode: InlineRenderNode | null = null;
    while (fromInlineRenderNode === null) {
      const fromPosition = renderManager.resolveSelectableOffset(from);
      const fromInlinePosition = getLeafPosition(fromPosition).parent!;
      if (!(fromInlinePosition.renderNode instanceof InlineRenderNode)) {
        return null;
      }
      fromInlineRenderNode = fromInlinePosition.renderNode;
      if (fromInlineRenderNode instanceof LineBreakInlineRenderNode) {
        fromInlineRenderNode = null;
        if (from === to) {
          if (from === 0) {
            return null;
          }
          from--;
          to--;
        } else {
          from++;
        }
      }
    }
    let toInlineRenderNode: InlineRenderNode | null = null;
    while (toInlineRenderNode === null) {
      const toPosition = renderManager.resolveSelectableOffset(to);
      const toInlinePosition = getLeafPosition(toPosition).parent!;
      if (!(toInlinePosition.renderNode instanceof InlineRenderNode)) {
        return null;
      }
      toInlineRenderNode = toInlinePosition.renderNode;
      if (toInlineRenderNode instanceof LineBreakInlineRenderNode) {
        toInlineRenderNode = null;
        if (from === to) {
          return null;
        }
        to--;
      }
    }
    if (fromInlineRenderNode === toInlineRenderNode) {
      return this.getInlineRenderNodeTextStyle(fromInlineRenderNode);
    }
    const textStyles: Array<TextStyle | null> = [];
    let inlineRenderNode: InlineRenderNode = fromInlineRenderNode;
    let isLastIteration = false;
    while (true) {
      const textStyle = this.getInlineRenderNodeTextStyle(inlineRenderNode);
      textStyles.push(textStyle);
      const nextSibling = inlineRenderNode.getNextSibling();
      if (!nextSibling) {
        break;
      }
      inlineRenderNode = nextSibling;
      if (isLastIteration) {
        break;
      }
      if (inlineRenderNode === toInlineRenderNode) {
        isLastIteration = true;
      }
    }
    const textStylesWithoutNull: TextStyle[] = [];
    textStyles.forEach(textStyle => textStyle && textStylesWithoutNull.push(textStyle));
    if (textStylesWithoutNull.length === 0) {
      return null;
    }
    const mergedTextStyle = textStylesWithoutNull.reduce(
      (mergedTextStyle, textStyle) => this.mergeTextStyles(
        mergedTextStyle,
        textStyle,
      ),
      textStylesWithoutNull[0],
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
