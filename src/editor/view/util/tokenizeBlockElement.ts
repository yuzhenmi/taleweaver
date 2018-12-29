import BlockElement from '../../model/BlockElement';
import Text from '../../model/Text';
import Token from '../tokens/Token';
import TextToken from '../tokens/TextToken';
import { WRAPPABLE_CHARS, PERSERVED_WRAPPABLE_CHARS } from './wrapText';

export default function tokenizeBlockElement(blockElement: BlockElement) {
  const tokens: Token[] = [];
  blockElement.getChildren().forEach(inlineElement => {
    if (inlineElement instanceof Text) {
      const content = inlineElement.getContent();
      let tokenStartIndex = 0;
      let n = 0;
      for (let nn = content.length; n < nn; n++) {
        const char = content[n];
        if (WRAPPABLE_CHARS.indexOf(char) >= 0) {
          if (PERSERVED_WRAPPABLE_CHARS.indexOf(char) >= 0) {
            tokens.push(new TextToken(
              content.substring(tokenStartIndex, n + 1),
              '',
              blockElement,
              inlineElement,
            ));
          } else {
            tokens.push(new TextToken(
              content.substring(tokenStartIndex, n),
              char,
              blockElement,
              inlineElement,
            ));
          }
          tokenStartIndex = n + 1;
        }
      }
      if (tokenStartIndex < n) {
        tokens.push(new TextToken(
          content.substring(tokenStartIndex, n),
          '',
          blockElement,
          inlineElement,
        ));
      }
    }
  });
  return tokens;
}
