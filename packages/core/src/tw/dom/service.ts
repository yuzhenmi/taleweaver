export interface IDOMService {
    getWindow(): Window;
    getDocument(): Document;
    getBody(): HTMLElement;
    createElement<TTagName extends keyof HTMLElementTagNameMap>(tagName: TTagName): HTMLElementTagNameMap[TTagName];
    createHiddenIframe(): HTMLIFrameElement;
    createContainer(): HTMLElement;
    createMutationObserver(callback: MutationCallback): MutationObserver;
}

export class DOMService implements IDOMService {
    getWindow(): Window {
        return window;
    }

    getDocument() {
        return document;
    }

    getBody() {
        return document.body;
    }

    createElement<TTagName extends keyof HTMLElementTagNameMap>(tagName: TTagName) {
        return document.createElement(tagName);
    }

    createContainer() {
        const container = this.createElement('div');
        container.setAttribute('data-tw-role', 'container');
        return container;
    }

    createHiddenIframe() {
        const iframe = this.createElement('iframe');
        iframe.scrolling = 'no';
        iframe.src = 'about:blank';
        iframe.style.width = '0';
        iframe.style.height = '0';
        iframe.style.border = 'none';
        iframe.style.position = 'fixed';
        iframe.style.zIndex = '-1';
        iframe.style.opacity = '0';
        iframe.style.overflow = 'hidden';
        iframe.style.left = '-1000000px';
        iframe.style.top = '-1000000px';
        return iframe;
    }

    createMutationObserver(callback: MutationCallback) {
        return new MutationObserver(callback);
    }
}
