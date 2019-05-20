import Editor from '../Editor';
import Token from '../token/Token';
import Element from '../model/Element';
import { insert } from '../command/commands';

const NON_CONTENT_TAG_NAMES = [
  'meta'
];

function interpretHTMLElement(editor: Editor, $element: HTMLElement): Element {
  const config = editor.getConfig();
  const elementClasses = config.getAllElementClasses();
  const tagName = $element.tagName;
  for (let n = 0, nn = elementClasses.length; n < nn; n++) {
    const elementClass = elementClasses[n];
    // @ts-ignore
    if (elementClass.compatibleHTMLTagNames.inludes(tagName)) {
      // @ts-ignore
      return elementClass.fromHTMLElement($element) as Element;
    }
  }
  // TODO: Handle with default / wildcard class, guess whether block or inline
  throw new Error('TODO');
}

const $iframe = document.createElement('iframe');
$iframe.scrolling = 'no';
$iframe.src = 'about:blank';
$iframe.style.width = '0';
$iframe.style.height = '0';
$iframe.style.border = 'none';
$iframe.style.position = 'fixed';
$iframe.style.zIndex = '-1';
$iframe.style.opacity = '0';
$iframe.style.overflow = 'hidden';
$iframe.style.left = '0';
$iframe.style.top = '0';
$iframe.contentEditable = 'true';
document.body.appendChild($iframe);

function paste(editor: Editor, data: DataTransfer) {
  const content = data.getData('text/html');
  $iframe.innerHTML = content;
  const elements: Element[] = [];
  for (let n = 0, nn = $iframe.children.length; n < nn; n++) {
    const $element = $iframe.children[n] as HTMLElement;
    if (NON_CONTENT_TAG_NAMES.includes($element.tagName.toLowerCase())) {
      continue;
    }
    elements.push(interpretHTMLElement(editor, $element));
  }
  const tokens: Token[] = [];
  elements.forEach(element => {
    tokens.push(...element.toTokens());
  });
  editor.getDispatcher().dispatchCommand(insert(tokens));
}

export default paste;
