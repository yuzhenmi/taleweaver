import Editor from '../../Editor';
import Transformation from '../../transform/Transformation';
import { Delete, Insert } from '../../transform/operations';
import Token from '../../token/Token';
import Command from '../Command';

export default function insert(tokens: Token[]): Command {
  return (editor: Editor): Transformation => {
    const transformation = new Transformation();
    const cursor = editor.getCursor();
    if (!cursor) {
      return transformation;
    }
    const anchor = cursor.getAnchor();
    const head = cursor.getHead();
    let collapsedAt = anchor;
    if (anchor < head) {
      transformation.addOperation(new Delete(
        editor.getRenderManager().convertSelectableOffsetToModelOffset(anchor),
        editor.getRenderManager().convertSelectableOffsetToModelOffset(head),
      ));
    } else if (anchor > head) {
      transformation.addOperation(new Delete(
        editor.getRenderManager().convertSelectableOffsetToModelOffset(head),
        editor.getRenderManager().convertSelectableOffsetToModelOffset(anchor),
      ));
      collapsedAt = head;
    }
    transformation.addOperation(new Insert(
      editor.getRenderManager().convertSelectableOffsetToModelOffset(collapsedAt),
      tokens,
    ));
    transformation.setCursor(collapsedAt + tokens.filter(t => typeof(t) === 'string').length);
    return transformation;
  };
}
