import { CLOSE_TOKEN, IToken, IOpenToken } from './token';

export function identifyTokenType(token: IToken) {
    if (token === CLOSE_TOKEN) {
        return 'CloseToken';
    }
    if (typeof token === 'string') {
        return 'ContentToken';
    }
    if (typeof token === 'object' && token.hasOwnProperty('componentId')) {
        return 'OpenToken';
    }
    throw new Error(`Failed to identify token type: ${token}.`);
}

export function identifyTokenModelType(token: IOpenToken) {
    if (token.componentId === "paragraph") {
        return 'Block';
    }
    return "Inline";
}
