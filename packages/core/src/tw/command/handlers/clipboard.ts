import { ICommandHandler } from '../command';

function createIframe() {
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
    return $iframe;
}

const $iframe = createIframe();
document.body.appendChild($iframe);

export const copy: ICommandHandler = async serviceRegistry => {
    const cursorService = serviceRegistry.getService('cursor');
    const renderService = serviceRegistry.getService('render');
    const modelService = serviceRegistry.getService('model');
    if (!cursorService.hasCursor()) {
        return;
    }
    const { anchor, head } = cursorService.getCursorState();
    if (anchor === head) {
        return;
    }
    const html = modelService.toHTML(
        renderService.convertOffsetToModelOffset(Math.min(anchor, head)),
        renderService.convertOffsetToModelOffset(Math.max(anchor, head)),
    );
    const iframeDocument = $iframe.contentDocument;
    if (!iframeDocument) {
        return;
    }
    iframeDocument.body.innerHTML = html;
    iframeDocument.execCommand('selectAll');
    iframeDocument.execCommand('copy');
    iframeDocument.body.innerHTML = '';
};
export const paste: ICommandHandler = async serviceRegistry => {
    // TODO
};
