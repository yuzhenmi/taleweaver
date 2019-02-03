import TaleWeaver from '../../TaleWeaver';
import CursorTransformation, { CursorTransformationFactory } from '../CursorTransformation';
import TranslateCursor from '../cursortransformationsteps/TranslateCursor';
import TranslateCursorHead from '../cursortransformationsteps/TranslateCursorHead';

export function translate(displacement: number): CursorTransformationFactory {
  return (taleWeaver: TaleWeaver): CursorTransformation => {
    const transformation = new CursorTransformation();
    transformation.addStep(new TranslateCursor(displacement));
    return transformation;
  };
}

export function translateTo(position: number): CursorTransformationFactory {
  return (taleWeaver: TaleWeaver): CursorTransformation => {
    const transformation = new CursorTransformation();
    const editorCursor = taleWeaver.getState().getEditorCursor();
    if (!editorCursor) {
      return transformation;
    }
    transformation.addStep(new TranslateCursor(position - editorCursor.getHead()));
    return transformation;
  };
}

export function translateHead(displacement: number): CursorTransformationFactory {
  return (taleWeaver: TaleWeaver): CursorTransformation => {
    const transformation = new CursorTransformation();
    transformation.addStep(new TranslateCursorHead(displacement));
    return transformation;
  };
}

export function translateHeadTo(position: number): CursorTransformationFactory {
  return (taleWeaver: TaleWeaver): CursorTransformation => {
    const transformation = new CursorTransformation();
    const editorCursor = taleWeaver.getState().getEditorCursor();
    if (!editorCursor) {
      return transformation;
    }
    transformation.addStep(new TranslateCursorHead(position - editorCursor.getHead()));
    return transformation;
  };
}

export function collapseForward(): CursorTransformationFactory {
  return (taleWeaver: TaleWeaver): CursorTransformation => {
    const transformation = new CursorTransformation();
    const editorCursor = taleWeaver.getState().getEditorCursor();
    if (!editorCursor) {
      return transformation;
    }
    if (editorCursor.getAnchor() < editorCursor.getHead()) {
      transformation.addStep(new TranslateCursor(0));
    } else if (editorCursor.getAnchor() > editorCursor.getHead()) {
      transformation.addStep(new TranslateCursor(editorCursor.getAnchor() - editorCursor.getHead()));
    }
    return transformation;
  };
}

export function collapseBackward(): CursorTransformationFactory {
  return (taleWeaver: TaleWeaver): CursorTransformation => {
    const transformation = new CursorTransformation();
    const editorCursor = taleWeaver.getState().getEditorCursor();
    if (!editorCursor) {
      return transformation;
    }
    if (editorCursor.getAnchor() < editorCursor.getHead()) {
      transformation.addStep(new TranslateCursor(editorCursor.getAnchor() - editorCursor.getHead()));
    } else if (editorCursor.getAnchor() > editorCursor.getHead()) {
      transformation.addStep(new TranslateCursor(0));
    }
    return transformation;
  };
}
