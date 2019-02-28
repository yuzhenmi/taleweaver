import Token from '../../state/Token';
import StartToken from '../../state/StartToken';
import EndToken from '../../state/EndToken';

interface ChildTokenGroup {
  id: string;
  type: string;
  tokens: Token[];
}

/**
 * Splits tokens into tokens grouped by child nodes.
 * @param tokens Tokens to be split.
 * @returns Splitted tokens.
 */
export default function splitTokens(tokens: Token[]): ChildTokenGroup[] {
  const result: ChildTokenGroup[] = [];
  let depth = 0;
  let startToken: StartToken;
  let startOffset = 1;
  for (let n = 1, nn = tokens.length - 1; n < nn; n++) {
    const token = tokens[n];
    if (token instanceof StartToken) {
      if (depth === 0) {
        startToken = token;
        startOffset = n;
      }
      depth++;
    } else if (token instanceof EndToken) {
      depth--;
      if (depth === 0) {
        result.push({
          id: startToken!.getAttributes().id,
          type: startToken!.getType(),
          tokens: tokens.slice(startOffset, n + 1),
        });
      }
    }
  }
  return result;
}
