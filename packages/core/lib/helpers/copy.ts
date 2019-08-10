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
$iframe.style.left = '-1000000px';
$iframe.style.top = '-1000000px';
$iframe.contentEditable = 'true';
document.body.appendChild($iframe);

function copy(editor: Editor) {
    const cursorService = editor.getCursorService();
    const modelService = editor.getModelService();
    const renderService = editor.getRenderService();
    const anchor = cursorService.getAnchor();
    const head = cursorService.getHead();
    if (anchor === head) {
        return;
    }
    const from = renderService.convertOffsetToModelOffset(Math.min(anchor, head));
    const to = renderService.convertOffsetToModelOffset(Math.max(anchor, head));
    const html = modelService.toHTML(from, to);
    $iframe.contentDocument!.body.innerHTML = html;
    $iframe.contentDocument!.execCommand('selectAll');
    $iframe.contentDocument!.execCommand('copy');
}

export default copy;
