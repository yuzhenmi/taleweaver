import { measureText } from './TextMeasurer';
import TextStyle from '../TextStyle';

export const WRAPPABLE_CHARS = [
  ' ',
  '\t',
  '-',
];

export const PERSERVED_WRAPPABLE_CHARS = [
  '-',
];

export default function wrapText(text: string, textStyle: TextStyle, availableWidth: number, mustWrap: Boolean): [string, string] {
  let lastWrappablePoint = 0;
  let lastWrappablePointPreserve = true;
  for (let n = 0, nn = text.length; n < nn; n++) {
    const char = text[n];
    if (WRAPPABLE_CHARS.indexOf(char) < 0) {
      continue;
    }
    const preserve = PERSERVED_WRAPPABLE_CHARS.indexOf(char) >= 0;
    if (preserve) {
      n++;
    }
    const { width: textWidth } = measureText(
      text.substring(0, n),
      textStyle,
    );
    if (textWidth > availableWidth) {
      break;
    }
    lastWrappablePoint = n;
    lastWrappablePointPreserve = preserve;
  }
  if (lastWrappablePoint === 0) {
    if (mustWrap) {
      return [text.substring(0, availableWidth), text.substring(availableWidth)];
    }
    return ['', text];
  }
  return [text.substring(0, lastWrappablePoint), text.substring(lastWrappablePointPreserve ? lastWrappablePoint : lastWrappablePoint + 1)];
}
