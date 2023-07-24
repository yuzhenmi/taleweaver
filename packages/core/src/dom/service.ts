interface CreateElementOptions {
    role?: string;
    className?: string;
}

export class DOMService {
    getWindow(): Window {
        return window;
    }

    getDocument() {
        return document;
    }

    getBody() {
        return document.body;
    }

    createElement<TTagName extends keyof HTMLElementTagNameMap>(tagName: TTagName, options?: CreateElementOptions) {
        const element = document.createElement(tagName);
        if (options) {
            if (options.role) {
                element.setAttribute('data-tw-role', options.role);
            }
            if (options.className) {
                element.className = `tw--${options.className}`;
            }
        }
        return element;
    }

    createHiddenIframe() {
        const iframe = this.createElement('iframe');
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
