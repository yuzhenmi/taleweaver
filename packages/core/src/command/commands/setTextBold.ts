import Editor from '../../Editor';
import Command from '../Command';
import generateID from '../../utils/generateID';
import Transformation from '../../transform/Transformation';
import OpenTagToken from '../../token/OpenTagToken';
import { Delete, Insert } from '../../transform/operations';
import CloseTagToken from '../../token/CloseTagToken';
import getInlinePosition from '../../model/utils/getInlinePosition';
import Element, { ResolvedPosition } from '../../model/Element';
import InlineElement from '../../model/InlineElement';

function updateTag(transformation: Transformation, at: number, element: Element, weight: number) {
  transformation.addOperation(new Delete(at, at + 1));
  transformation.addOperation(new Insert(at, [new OpenTagToken(
    element.getType(),
    element.getID(),
    { ...element.getAttributes(), weight },
  )]));
}

function openTag(transformation: Transformation, at: number, element: Element, weight: number) {
  transformation.addOperation(new Insert(at, [
    new CloseTagToken(),
    new OpenTagToken(
      element.getType(),
      generateID(),
      {
        ...element.getAttributes(),
        weight,
      },
    ),
  ]));
}

function closeTag(transformation: Transformation, at: number, element: Element, weight: number) {
  transformation.addOperation(new Insert(at, [
    new CloseTagToken(),
    new OpenTagToken(
      element.getType(),
      generateID(),
      element.getAttributes(),
    ),
  ]));
}

export default function setTextBold(value: boolean): Command {
  return (editor: Editor): Transformation => {
    const transformation = new Transformation();
    const cursor = editor.getCursor();
    if (!cursor) {
      return transformation;
    }
    const anchor = cursor.getAnchor();
    const head = cursor.getHead();
    const renderManager = editor.getRenderManager();
    const from = renderManager.getModelOffset(Math.min(anchor, head));
    const to = renderManager.getModelOffset(Math.max(anchor, head));
    if (from === to) {
      return transformation;
    }
    const modelManager = editor.getModelManager();
    const fromPosition = modelManager.resolveOffset(from);
    const toPosition = modelManager.resolveOffset(to);
    const weight = value ? 700 : 400;
    const fromInlinePosition = getInlinePosition(fromPosition);
    const toInlinePosition = getInlinePosition(toPosition);
    if (fromInlinePosition.element.getAttributes().weight !== weight) {
      if (fromInlinePosition.offset === 1) {
        updateTag(transformation, from - 1, fromInlinePosition.element, weight);
      } else {
        openTag(transformation, from, fromInlinePosition.element, weight);
      }
    }
    if (toInlinePosition.element.getAttributes().weight !== weight) {
      if (toInlinePosition.offset < toInlinePosition.element.getSize() - 2) {
        closeTag(transformation, to - 1, toInlinePosition.element, weight);
      }
    }
    // if (fromInlinePosition.element !== toInlinePosition.element) {
    //   let element: InlineElement | null = fromInlinePosition.element as InlineElement;
    //   const toElement = toInlinePosition.element as InlineElement;
    //   element = element.getNextSibling();
    //   while (element && element !== toElement) {
    //     updateTag(transformation, getDocOffset(element), element, weight);
    //     element = element.getNextSibling();
    //   }
    // }
    return transformation;
  };
}
