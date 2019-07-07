import Editor from '../../Editor';
import Transformation from '../../transform/Transformation';
import { Delete, Insert } from '../../transform/operations';
import Token from '../../token/Token';
import Command from '../Command';
import OpenTagToken from '../../token/OpenTagToken';

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
        editor.getRenderManager().getModelOffset(anchor),
        editor.getRenderManager().getModelOffset(head),
      ));
    } else if (anchor > head) {
      transformation.addOperation(new Delete(
        editor.getRenderManager().getModelOffset(head),
        editor.getRenderManager().getModelOffset(anchor),
      ));
      collapsedAt = head;
    }
    transformation.addOperation(new Insert(
      editor.getRenderManager().getModelOffset(collapsedAt),
      tokens,
    ));
    const elementConfig = editor.getConfig().getElementConfig();
    const insertedSelectableSize = tokens.filter(token => {
      if (typeof(token) === 'string') {
        return true;
      }
      if (token instanceof OpenTagToken) {
        try {
          elementConfig.getBlockElementClass(token.getType());
          return true;
        } catch (error) {}
      }
      return false;
    }).length;
    transformation.setCursor(collapsedAt + insertedSelectableSize);
    return transformation;
  };
}
