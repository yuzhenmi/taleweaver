import State from '../State';
import DocStartToken from '../DocStartToken';
import DocEndToken from '../DocEndToken';
import BlockStartToken from '../BlockStartToken';
import BlockEndToken from '../BlockEndToken';
import InlineStartToken from '../InlineStartToken';
import InlineEndToken from '../InlineEndToken';

class Serializer {
  serialize(state: State): string {
    const tokens = state.getTokens();
    return tokens.map(token => {
      if (token instanceof DocStartToken) {
        const docStartToken = token as DocStartToken;
        return `<Doc ${JSON.stringify(docStartToken.getAttributes())}>`;
      }
      if (token instanceof DocEndToken) {
        return '</Doc>';
      }
      if (token instanceof BlockStartToken) {
        const blockStartToken = token as BlockStartToken;
        return `<Block.${blockStartToken.getType()} ${JSON.stringify(token.getAttributes())}>`;
      }
      if (token instanceof BlockEndToken) {
        return '</Block>';
      }
      if (token instanceof InlineStartToken) {
        const inilneStartToken = token as InlineStartToken;
        return `<Inline.${inilneStartToken.getType()} ${JSON.stringify(token.getAttributes())}>`;
      }
      if (token instanceof InlineEndToken) {
        return '</Inline>';
      }
      if (token === '\n') {
        return '\\n';
      }
      return token;
    }).join('\n');
  }

  parse(serializedTokens: string): State {
    const tokens = serializedTokens.split('\n').map(serializedToken => {
      const docStartTokenRegex = /^<Doc\s(.+)>/;
      if (docStartTokenRegex.test(serializedToken)) {
        const result = serializedToken.match(docStartTokenRegex)!;
        const attributes = JSON.parse(result[1]);
        return new DocStartToken(attributes);
      }
      if (serializedToken === '</Doc>') {
        return new DocEndToken();
      }
      const blockStartTokenRegex = /^<Block\.(\w+)\s(.+)>/;
      if (blockStartTokenRegex.test(serializedToken)) {
        const result = serializedToken.match(blockStartTokenRegex)!;
        const type = result[1];
        const attributes = JSON.parse(result[2]);
        return new BlockStartToken(type, attributes);
      }
      if (serializedToken === '</Block>') {
        return new BlockEndToken();
      }
      const inlineStartTokenRegex = /^<Inline\.(\w+)\s(.+)>/;
      if (inlineStartTokenRegex.test(serializedToken)) {
        const result = serializedToken.match(inlineStartTokenRegex)!;
        const type = result[1];
        const attributes = JSON.parse(result[2]);
        return new InlineStartToken(type, attributes);
      }
      if (serializedToken === '</Inline>') {
        return new InlineEndToken();
      }
      if (serializedToken.length === 1) {
        return serializedToken;
      }
      if (serializedToken === '\\n') {
        return '\n';
      }
      throw new Error(`Cannot parse serialized token: ${serializedToken}`);
    });
    const state = new State(tokens);
    return state;
  }
}

export default Serializer;
