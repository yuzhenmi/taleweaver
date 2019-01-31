import { CursorTransformation, TranslateCursor, TranslateCursorHead } from '../CursorTransformer';

export function translateCursor(displacement: number): CursorTransformation {
  const transformation = new CursorTransformation();
  transformation.addStep(new TranslateCursor(displacement));
  return transformation;
}

export function translateCursorHead(displacement: number): CursorTransformation {
  const transformation = new CursorTransformation();
  transformation.addStep(new TranslateCursorHead(displacement));
  return transformation;
}
