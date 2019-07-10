import Editor from '../../Editor';
import Command from '../Command';
import Transformation from '../../transform/Transformation';
import Token from '../../token/Token';
import OpenTagToken from '../../token/OpenTagToken';
import { Delete, Insert } from '../../transform/operations';

export default function setTextItalic(value: boolean): Command {
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
    const tokenManager = editor.getTokenManager();
    const tokens = tokenManager.getTokenState().getTokens();
    let token: Token;
    for (let n = from; n < to; n++) {
      token = tokens[n];
      if (token instanceof OpenTagToken && token.getType() === 'Text') {
        transformation.addOperation(new Delete(n, n + 1));
        transformation.addOperation(new Insert(n, [new OpenTagToken(
          token.getType(),
          token.getID(),
          {
            ...token.getAttributes(),
            italic: value,
          },
        )]));
      }
    }
    return transformation;
  };
}
