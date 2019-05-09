import Editor from '../Editor';
import Transformation from '../transform/Transformation';
import AppliedTransformation from '../transform/AppliedTransformation';
import TokenState from './TokenState';
import Tokenizer from './Tokenizer';

class TokenManager {
  protected editor: Editor;
  protected tokenState: TokenState;

  constructor(editor: Editor, markup: string) {
    this.editor = editor;
    const tokenizer = new Tokenizer(markup);
    const tokens = tokenizer.getTokens();
    this.tokenState = new TokenState(editor, tokens);
  }

  getTokenState() {
    return this.tokenState;
  }

  applyTransformations(transformations: Transformation[]) {
    return this.tokenState.applyTransformations(transformations);
  }

  unapplyTransformations(appliedTransformations: AppliedTransformation[]) {
    this.tokenState.unapplyTransformations(appliedTransformations);
  }
}

export default TokenManager;
