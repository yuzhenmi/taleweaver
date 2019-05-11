import Editor from '../Editor';

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

function copy(editor: Editor) {
  const cursor = editor.getCursor();
  const anchor = cursor.getAnchor();
  const head = cursor.getHead();
  if (anchor === head) {
    return;
  }
  const renderManager = editor.getRenderManager();
  const from = renderManager.convertSelectableOffsetToModelOffset(Math.min(anchor, head));
  const to = renderManager.convertSelectableOffsetToModelOffset(Math.max(anchor, head));
  const html = editor.getModelManager().toHTML(from, to);
  $iframe.contentDocument!.body.innerHTML = html;
  $iframe.contentDocument!.execCommand('selectAll');
  $iframe.contentDocument!.execCommand('copy');
}

export default copy;
