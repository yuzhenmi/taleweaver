import TaleWeaver from '../../TaleWeaver';
import CursorTransformation from '../CursorTransformation';
import TranslateCursor from '../cursortransformationsteps/TranslateCursor';
import TranslateCursorHead from '../cursortransformationsteps/TranslateCursorHead';

export function translate(displacement: number, taleWeaver: TaleWeaver): CursorTransformation {
  const transformation = new CursorTransformation();
  transformation.addStep(new TranslateCursor(displacement));
  return transformation;
}

export function translateHead(displacement: number, taleWeaver: TaleWeaver): CursorTransformation {
  const transformation = new CursorTransformation();
  transformation.addStep(new TranslateCursorHead(displacement));
  return transformation;
}

export function collapseForward(taleWeaver: TaleWeaver): CursorTransformation {
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
}

export function collapseBackward(taleWeaver: TaleWeaver): CursorTransformation {
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
}
