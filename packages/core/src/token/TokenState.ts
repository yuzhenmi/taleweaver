import Editor from '../Editor';
import { TokenStateUpdatedEvent } from '../dispatch/events';
import Token from './Token';
import Transformation from '../transform/Transformation';
import AppliedTransformation from '../transform/AppliedTransformation';
import { OffsetAdjustment } from '../transform/Operation';
import Insert, { AppliedInsert } from '../transform/operations/Insert';
import Delete, { AppliedDelete } from '../transform/operations/Delete';

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

  applyTransformation(transformation: Transformation): AppliedTransformation {
    const cursor = this.editor.getCursor();
    const appliedTransformation = new AppliedTransformation(
      transformation,
      cursor.getAnchor(),
      cursor.getHead(),
      cursor.getLeftLock(),
    );
    const operations = transformation.getOperations();
    if (operations.length === 0) {
      return appliedTransformation;
    }
    const offsetAdjustments: OffsetAdjustment[] = [];
    operations.forEach(unadjustedOperation => {
      const operation = unadjustedOperation.adjustOffset(offsetAdjustments);
      if (operation instanceof Insert) {
        this.tokens.splice(operation.getAt(), 0, ...operation.getTokens());
        const appliedOperation = new AppliedInsert(operation.getAt(), operation.getTokens());
        appliedTransformation.addOperation(appliedOperation);
      } else if (operation instanceof Delete) {
        const deletedTokens = this.tokens.splice(operation.getFrom(), operation.getTo() - operation.getFrom());
        const appliedOperation = new AppliedDelete(operation.getFrom(), deletedTokens);
        appliedTransformation.addOperation(appliedOperation);
      } else {
        throw new Error('Unknown transformation operation encountered.');
      }
      offsetAdjustments.push(operation.getOffsetAdjustment());
    });
    this.editor.getDispatcher().dispatch(new TokenStateUpdatedEvent());
    return appliedTransformation;
  }

  unapplyTransformation(appliedTransformation: AppliedTransformation) {
    appliedTransformation.getOperations().reverse().forEach(appliedOperation => {
      if (appliedOperation instanceof AppliedInsert) {
        this.tokens.splice(appliedOperation.getAt(), appliedOperation.getTokens().length);
      } else if (appliedOperation instanceof AppliedDelete) {
        this.tokens.splice(appliedOperation.getAt(), 0, ...appliedOperation.getTokens());
      } else {
        throw new Error('Unknown applied transformation operation encountered.');
      }
    });
    this.editor.getDispatcher().dispatch(new TokenStateUpdatedEvent());
  }
}

export default TokenState;
