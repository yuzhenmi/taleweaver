import TaleWeaver from '../../TaleWeaver';
import CursorTransformation, { CursorTransformationFactory } from '../CursorTransformation';
import TranslateCursor from '../cursortransformationsteps/TranslateCursor';
import TranslateCursorHead from '../cursortransformationsteps/TranslateCursorHead';

export function moveLeft(): CursorTransformationFactory {
  return (taleWeaver: TaleWeaver): CursorTransformation => {
    const transformation = new CursorTransformation();
    const editorCursor = taleWeaver.getState().getEditorCursor();
    if (!editorCursor) {
      return transformation;
    }
    const anchor = editorCursor.getAnchor();
    const head = editorCursor.getHead();
    if (anchor === head) {
      if (head < 1) {
        return transformation;
      }
      transformation.addStep(new TranslateCursor(-1));
    } else {
      if (anchor < head) {
        transformation.addStep(new TranslateCursor(anchor - head));
      } else if (anchor > head) {
        transformation.addStep(new TranslateCursor(0));
      }
    }
    return transformation;
  };
}

export function moveHeadLeft(): CursorTransformationFactory {
  return (taleWeaver: TaleWeaver): CursorTransformation => {
    const transformation = new CursorTransformation();
    const editorCursor = taleWeaver.getState().getEditorCursor();
    if (!editorCursor) {
      return transformation;
    }
    if (editorCursor.getHead() < 1) {
      return transformation;
    }
    transformation.addStep(new TranslateCursorHead(-1));
    return transformation;
  };
}

export function moveRight(): CursorTransformationFactory {
  return (taleWeaver: TaleWeaver): CursorTransformation => {
    const transformation = new CursorTransformation();
    const editorCursor = taleWeaver.getState().getEditorCursor();
    if (!editorCursor) {
      return transformation;
    }
    const anchor = editorCursor.getAnchor();
    const head = editorCursor.getHead();
    if (anchor === head) {
      const documentSize = taleWeaver.getState().getDocumentElement().getSize();
      if (head > documentSize - 1) {
        return transformation;
      }
      transformation.addStep(new TranslateCursor(1));
    } else {
      if (anchor < head) {
        transformation.addStep(new TranslateCursor(0));
      } else if (anchor > head) {
        transformation.addStep(new TranslateCursor(anchor - head));
      }
    }
    return transformation;
  };
}

export function moveHeadRight(): CursorTransformationFactory {
  return (taleWeaver: TaleWeaver): CursorTransformation => {
    const transformation = new CursorTransformation();
    const editorCursor = taleWeaver.getState().getEditorCursor();
    if (!editorCursor) {
      return transformation;
    }
    if (editorCursor.getHead() > taleWeaver.getState().getDocumentElement().getSize() - 1) {
      return transformation;
    }
    transformation.addStep(new TranslateCursorHead(1));
    return transformation;
  };
}

export function moveTo(position: number): CursorTransformationFactory {
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

export function moveHeadTo(position: number): CursorTransformationFactory {
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

export function moveLeftByWord(): CursorTransformationFactory {
  return (taleWeaver: TaleWeaver): CursorTransformation => {
    const transformation = new CursorTransformation();
    const editorCursor = taleWeaver.getState().getEditorCursor();
    if (!editorCursor) {
      return transformation;
    }
    const head = editorCursor.getHead();
    const documentView = taleWeaver.getDocumentView();
    const wordStart = documentView.getWordStartPosition(head);
    transformation.addStep(new TranslateCursor(wordStart - head));
    return transformation;
  };
}

export function moveHeadLeftByWord(): CursorTransformationFactory {
  return (taleWeaver: TaleWeaver): CursorTransformation => {
    const transformation = new CursorTransformation();
    const editorCursor = taleWeaver.getState().getEditorCursor();
    if (!editorCursor) {
      return transformation;
    }
    const head = editorCursor.getHead();
    const documentView = taleWeaver.getDocumentView();
    const wordStart = documentView.getWordStartPosition(head);
    transformation.addStep(new TranslateCursorHead(wordStart - head));
    return transformation;
  };
}

export function moveRightByWord(): CursorTransformationFactory {
  return (taleWeaver: TaleWeaver): CursorTransformation => {
    const transformation = new CursorTransformation();
    const editorCursor = taleWeaver.getState().getEditorCursor();
    if (!editorCursor) {
      return transformation;
    }
    const head = editorCursor.getHead();
    const documentView = taleWeaver.getDocumentView();
    const wordEnd = documentView.getWordEndPosition(head);
    transformation.addStep(new TranslateCursor(wordEnd - head));
    return transformation;
  };
}

export function moveHeadRightByWord(): CursorTransformationFactory {
  return (taleWeaver: TaleWeaver): CursorTransformation => {
    const transformation = new CursorTransformation();
    const editorCursor = taleWeaver.getState().getEditorCursor();
    if (!editorCursor) {
      return transformation;
    }
    const head = editorCursor.getHead();
    const documentView = taleWeaver.getDocumentView();
    const wordEnd = documentView.getWordEndPosition(head);
    transformation.addStep(new TranslateCursorHead(wordEnd - head));
    return transformation;
  };
}

export function moveLeftByLine(): CursorTransformationFactory {
  return (taleWeaver: TaleWeaver): CursorTransformation => {
    const transformation = new CursorTransformation();
    const editorCursor = taleWeaver.getState().getEditorCursor();
    if (!editorCursor) {
      return transformation;
    }
    const head = editorCursor.getHead();
    const documentView = taleWeaver.getDocumentView();
    const lineStart = documentView.getLineStartPosition(head);
    transformation.addStep(new TranslateCursor(lineStart - head));
    return transformation;
  };
}

export function moveHeadLeftByLine(): CursorTransformationFactory {
  return (taleWeaver: TaleWeaver): CursorTransformation => {
    const transformation = new CursorTransformation();
    const editorCursor = taleWeaver.getState().getEditorCursor();
    if (!editorCursor) {
      return transformation;
    }
    const head = editorCursor.getHead();
    const documentView = taleWeaver.getDocumentView();
    const lineStart = documentView.getLineStartPosition(head);
    transformation.addStep(new TranslateCursorHead(lineStart - head));
    return transformation;
  };
}

export function moveRightByLine(): CursorTransformationFactory {
  return (taleWeaver: TaleWeaver): CursorTransformation => {
    const transformation = new CursorTransformation();
    const editorCursor = taleWeaver.getState().getEditorCursor();
    if (!editorCursor) {
      return transformation;
    }
    const head = editorCursor.getHead();
    const documentView = taleWeaver.getDocumentView();
    const lineEnd = documentView.getLineEndPosition(head);
    transformation.addStep(new TranslateCursor(lineEnd - head));
    return transformation;
  };
}

export function moveHeadRightByLine(): CursorTransformationFactory {
  return (taleWeaver: TaleWeaver): CursorTransformation => {
    const transformation = new CursorTransformation();
    const editorCursor = taleWeaver.getState().getEditorCursor();
    if (!editorCursor) {
      return transformation;
    }
    const head = editorCursor.getHead();
    const documentView = taleWeaver.getDocumentView();
    const lineEnd = documentView.getLineEndPosition(head);
    transformation.addStep(new TranslateCursorHead(lineEnd - head));
    return transformation;
  };
}

export function moveToDocumentStart(): CursorTransformationFactory {
  return (taleWeaver: TaleWeaver): CursorTransformation => {
    const transformation = new CursorTransformation();
    const editorCursor = taleWeaver.getState().getEditorCursor();
    if (!editorCursor) {
      return transformation;
    }
    const head = editorCursor.getHead();
    transformation.addStep(new TranslateCursor(0 - head));
    return transformation;
  };
}

export function moveHeadToDocumentStart(): CursorTransformationFactory {
  return (taleWeaver: TaleWeaver): CursorTransformation => {
    const transformation = new CursorTransformation();
    const editorCursor = taleWeaver.getState().getEditorCursor();
    if (!editorCursor) {
      return transformation;
    }
    const head = editorCursor.getHead();
    transformation.addStep(new TranslateCursorHead(0 - head));
    return transformation;
  };
}

export function moveToDocumentEnd(): CursorTransformationFactory {
  return (taleWeaver: TaleWeaver): CursorTransformation => {
    const transformation = new CursorTransformation();
    const editorCursor = taleWeaver.getState().getEditorCursor();
    if (!editorCursor) {
      return transformation;
    }
    const head = editorCursor.getHead();
    const documentSize = taleWeaver.getState().getDocumentElement().getSize();
    transformation.addStep(new TranslateCursor(documentSize - head));
    return transformation;
  };
}

export function moveHeadToDocumentEnd(): CursorTransformationFactory {
  return (taleWeaver: TaleWeaver): CursorTransformation => {
    const transformation = new CursorTransformation();
    const editorCursor = taleWeaver.getState().getEditorCursor();
    if (!editorCursor) {
      return transformation;
    }
    const head = editorCursor.getHead();
    const documentSize = taleWeaver.getState().getDocumentElement().getSize();
    transformation.addStep(new TranslateCursorHead(documentSize - head));
    return transformation;
  };
}
