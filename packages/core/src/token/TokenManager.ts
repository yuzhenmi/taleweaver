import Editor from '../Editor';
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
}

export default TokenManager;
