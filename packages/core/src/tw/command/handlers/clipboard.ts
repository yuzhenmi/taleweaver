import { createHiddenIframe, isDOMAvailable } from '../../util/dom';
import { ICommandHandler } from '../command';

let iframe: HTMLIFrameElement | undefined;
if (isDOMAvailable()) {
    iframe = createHiddenIframe();
    document.body.appendChild(iframe);
}

export const copy: ICommandHandler = async (serviceRegistry) => {
    if (!iframe) {
        return;
    }
    const cursorService = serviceRegistry.getService('cursor');
    const modelService = serviceRegistry.getService('model');
    const renderService = serviceRegistry.getService('render');
    const componentService = serviceRegistry.getService('component');
    if (!cursorService.hasCursor()) {
        return;
    }
    const { anchor, head } = cursorService.getCursor();
    if (anchor === head) {
        return;
    }
    const html = componentService.convertModelToDOM(
        modelService.getRoot(),
        modelService.resolvePosition(renderService.convertRenderToModelPosition(Math.min(anchor, head))),
        modelService.resolvePosition(renderService.convertRenderToModelPosition(Math.max(anchor, head))),
    ).outerHTML;
    const iframeDocument = iframe.contentDocument;
    if (!iframeDocument) {
        return;
    }
    iframeDocument.body.innerHTML = html;
    iframeDocument.execCommand('selectAll');
    iframeDocument.execCommand('copy');
    iframeDocument.body.innerHTML = '';
};

export const paste: ICommandHandler = async (serviceRegistry) => {
    // Not yet possible due to browser limitation
    // Pending development of async clipboard api
    // https://developer.mozilla.org/en-US/docs/Web/API/Clipboard_API
};
