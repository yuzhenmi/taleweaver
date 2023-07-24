import { CursorService } from '../../cursor/service';
import { DOMService } from '../../dom/service';
import { CommandHandler } from '../command';

export class CopyCommandHandler implements CommandHandler {
    static dependencies = ['cursor', 'dom'] as const;

    private internalIframe?: HTMLIFrameElement;

    constructor(protected cursorService: CursorService, protected domService: DOMService) {}

    async handle() {
        const cursor = this.cursorService.getCursor();
        if (!cursor) {
            return;
        }
        if (cursor.anchor === cursor.head) {
            return;
        }
        const iframeDocument = this.iframe.contentDocument;
        if (!iframeDocument) {
            return;
        }
        const html = ''; // TODO
        iframeDocument.body.innerHTML = html;
        iframeDocument.execCommand('selectAll');
        iframeDocument.execCommand('copy');
        iframeDocument.body.innerHTML = '';
    }

    protected get iframe() {
        if (!this.internalIframe) {
            this.internalIframe = this.domService.createHiddenIframe();
            this.domService.getBody().appendChild(this.internalIframe);
        }
        return this.internalIframe;
    }
}

export class PasteCommandHandler implements CommandHandler {
    static dependencies = [] as const;

    async handle() {
        // TODO
    }
}
