export function isDOMAvailable() {
    return typeof window !== 'undefined';
}

export function createHiddenIframe() {
    const iframe = document.createElement('iframe');
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
