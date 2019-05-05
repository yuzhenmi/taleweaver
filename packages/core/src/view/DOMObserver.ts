import Editor from '../Editor';
import { CursorFocusedEvent, CursorBlurredEvent } from '../dispatch/events';
import Token from '../token/Token';
import getKeySignatureFromKeyboardEvent from '../input/utils/getKeySignatureFromKeyboardEvent';
import * as cursorCommands from '../input/cursorCommands';
import * as docCommands from '../input/docCommands';
import DocViewNode from './DocViewNode';

function parseNode(node: Node): Token[] {
  if (node.nodeValue) {
    return node.nodeValue.split('');
  }
  const tokens: Token[] = [];
  node.childNodes.forEach(childNode => {
    tokens.push(...parseNode(childNode));
  });
  return tokens;
}

export default class DOMObserver {
  protected editor: Editor;
  protected docViewNode?: DocViewNode;
  protected $iframe: HTMLIFrameElement;
  protected $contentEditable: HTMLDivElement;
  protected mutationObserver: MutationObserver;
  protected isComposing: boolean;
  protected isFocused: boolean;
  protected isMouseDown: boolean;

  constructor(editor: Editor) {
    this.editor = editor;
    this.$iframe = document.createElement('iframe');
    this.$iframe.scrolling = 'no';
    this.$iframe.src = 'about:blank';
    this.$iframe.style.width = '0';
    this.$iframe.style.height = '0';
    this.$iframe.style.border = 'none';
    this.$iframe.style.position = 'fixed';
    this.$iframe.style.zIndex = '-1';
    this.$iframe.style.opacity = '0';
    this.$iframe.style.overflow = 'hidden';
    this.$iframe.style.left = '0';
    this.$iframe.style.top = '0';
    this.$contentEditable = document.createElement('div');
    this.$contentEditable.contentEditable = 'true';
    this.$contentEditable.style.whiteSpace = 'pre';
    this.mutationObserver = new MutationObserver(this.onInput);
    this.isComposing = false;
    this.isFocused = false;
    this.isMouseDown = false;
  }

  connect(docViewNode: DocViewNode) {
    this.docViewNode = docViewNode;
    const docViewDOMContainer = docViewNode.getDOMContainer();
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mouseup', this.onMouseUp);
    document.body.appendChild(this.$iframe);
    this.$iframe.contentDocument!.body.appendChild(this.$contentEditable);
    this.$contentEditable.addEventListener('keydown', this.onKeyDown);
    this.$contentEditable.addEventListener('compositionstart', () => {
      this.isComposing = true;
    });
    this.$contentEditable.addEventListener('compositionend', () => {
      this.isComposing = false;
    });
    this.mutationObserver.observe(this.$contentEditable, {
      subtree: true,
      characterData: true,
      childList: true,
    });
  }

  getIsFocused() {
    return this.isFocused;
  }

  protected onFocus() {
    this.isFocused = true;
    this.$contentEditable.focus();
    this.editor.getDispatcher().dispatch(new CursorFocusedEvent());
  }

  protected onBlur() {
    this.isFocused = false;
    this.$contentEditable.blur();
    this.editor.getDispatcher().dispatch(new CursorBlurredEvent());
  }

  protected onMouseDown = (event: MouseEvent) => {
    if (!(event.target instanceof HTMLElement)) {
      return;
    }
    // Ignore if target is not in page
    let isInPage = false;
    let currentElement: HTMLElement | null = event.target;
    while (currentElement) {
      if (currentElement.getAttribute('data-tw-role') === 'page') {
        isInPage = true;
        break;
      }
      currentElement = currentElement.parentElement;
    }
    if (!isInPage) {
      this.onBlur();
      return;
    }
    this.onFocus();
    // Bypass browser selection
    event.preventDefault();
    this.isMouseDown = true;
    const offset = this.resolveScreenPosition(event.clientX, event.clientY);
    if (offset < 0) {
      return;
    }
    this.editor.getDispatcher().dispatchCommand(cursorCommands.moveTo(offset));
  }

  protected onMouseMove = (event: MouseEvent) => {
    if (!this.isMouseDown) {
      return;
    }
    const offset = this.resolveScreenPosition(event.clientX, event.clientY);
    if (offset < 0) {
      return;
    }
    this.editor.getDispatcher().dispatchCommand(cursorCommands.moveHeadTo(offset));
  }

  protected onMouseUp = (event: MouseEvent) => {
    this.isMouseDown = false;
  }

  protected onKeyDown = (event: KeyboardEvent) => {
    const keySignature = getKeySignatureFromKeyboardEvent(event);
    if (!keySignature) {
      return;
    }
    const handled = this.editor.getDispatcher().dispatchKeyPress(keySignature);
    if (handled) {
      event.preventDefault();
    }
  }

  protected onInput = () => {
    setTimeout(() => {
      if (this.isComposing) {
        return;
      }
      const tokens = this.parseContentEditableValue();
      this.$contentEditable.innerHTML = '';
      if (tokens.length === 0) {
        return;
      }
      const dispatcher = this.editor.getDispatcher();
      dispatcher.dispatchCommand(docCommands.insert(tokens));
    });
  }

  protected resolveScreenPosition(x: number, y: number): number {
    if (!this.docViewNode) {
      throw new Error('No doc view is being observed.');
    }
    const pageViews = this.docViewNode.getChildren();
    const pageFlowBoxes = this.editor.getLayoutManager().getDocBox().getChildren();
    let cumulatedOffset = 0;
    for (let n = 0, nn = pageViews.length; n < nn; n++) {
      const pageView = pageViews[n];
      const pageFlowBox = pageFlowBoxes[n];
      const pageDOMContainer = pageView.getDOMContainer();
      const pageBoundingClientRect = pageDOMContainer.getBoundingClientRect();
      if (
        pageBoundingClientRect.left <= x &&
        pageBoundingClientRect.right >= x &&
        pageBoundingClientRect.top <= y &&
        pageBoundingClientRect.bottom >= y
      ) {
        const relativeX = x - pageBoundingClientRect.left;
        const relativeY = y - pageBoundingClientRect.top;
        return cumulatedOffset + pageFlowBox.resolveViewportPositionToSelectableOffset(relativeX, relativeY);
      }
      cumulatedOffset += pageFlowBox.getSelectableSize();
    }
    return -1;
  }

  protected parseContentEditableValue(): Token[] {
    const tokens: Token[] = [];
    this.$contentEditable.childNodes.forEach(childNode => {
      tokens.push(...parseNode(childNode));
    });
    return tokens;
  }
}
