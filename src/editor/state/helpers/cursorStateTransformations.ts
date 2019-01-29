import CursorStateTransformation, { TranslateCursor, TranslateCursorHead } from '../CursorStateTransformation';

export function translateCursor(displacement: number): CursorStateTransformation {
  const transformation = new CursorStateTransformation();
  transformation.addStep(new TranslateCursor(displacement));
  return transformation;
}

export function translateCursorHead(displacement: number): CursorStateTransformation {
  const transformation = new CursorStateTransformation();
  transformation.addStep(new TranslateCursorHead(displacement));
  return transformation;
}
