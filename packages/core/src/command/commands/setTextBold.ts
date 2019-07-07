import Editor from '../../Editor';
import Command from '../Command';
import Transformation from '../../transform/Transformation';

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
    
    const docBox = editor.getLayoutManager().getDocBox();
    transformation.setCursor(0);
    transformation.setCursorHead(docBox.getSize() - 1);
    return transformation;
  };
}
