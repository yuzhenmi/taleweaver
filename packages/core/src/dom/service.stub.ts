import { JSDOM } from 'jsdom';
import { DOMService, IDOMService } from './service';

class MutationObserverStub implements MutationObserver {
    constructor(callback: MutationCallback) {}

    disconnect() {}

    observe(target: Node, options?: MutationObserverInit) {}

    takeRecords(): MutationRecord[] {
        return [];
    }
}

export class DOMServiceStub extends DOMService implements IDOMService {
    protected dom = new JSDOM();

    getWindow() {
        return this.dom.window;
    }

    getDocument() {
        return this.getWindow().document;
    }

    getBody() {
        return this.getDocument().body;
    }

    createElement<TTagName extends keyof HTMLElementTagNameMap>(tagName: TTagName) {
        return this.getDocument().createElement(tagName);
    }

    createMutationObserver(callback: MutationCallback) {
        return new MutationObserverStub(callback);
    }
}
