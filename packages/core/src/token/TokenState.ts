import Editor from '../Editor';
import Token from './Token';
import OpenTagToken from './OpenTagToken';
import CloseTagToken from './CloseTagToken';
import Transformation from '../transform/Transformation';
import { OffsetAdjustment } from '../transform/Operation';
import Insert from '../transform/operations/Insert';
import Delete from '../transform/operations/Delete';
import { TokenStateUpdatedEvent } from '../dispatch/events';

class TokenState {
  protected editor: Editor;
  protected tokens: Token[];

  constructor(editor: Editor, tokens: Token[]) {
    this.editor = editor;
    this.tokens = tokens;
  }

  getTokens(): Token[] {
    return this.tokens;
  }

  applyTransformation(transformation: Transformation) {
    const operations = transformation.getOperations();
    if (operations.length === 0) {
      return;
    }
    const offsetAdjustments: OffsetAdjustment[] = [];
    operations.forEach(operation => {
      offsetAdjustments.forEach(offsetAdjustment => operation.adjustOffsetBy(offsetAdjustment));
      if (operation instanceof Insert) {
        this.tokens.splice(operation.getAt(), 0, ...operation.getTokens());
      } else if (operation instanceof Delete) {
        this.tokens.splice(operation.getFrom(), operation.getTo() - operation.getFrom());
        // Delete surrounding tokens if they are open / close tags without content
        while (this.tokens[operation.getFrom() - 1] instanceof OpenTagToken && this.tokens[operation.getFrom()] instanceof CloseTagToken) {
          this.tokens.splice(operation.getFrom() - 1, 2);
        }
      } else {
        throw new Error('Unknown state transformation operation encountered.');
      }
      offsetAdjustments.push(operation.getOffsetAdjustment());
    });
    this.editor.getDispatcher().dispatch(new TokenStateUpdatedEvent());
  }
}

export default TokenState;
