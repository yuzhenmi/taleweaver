import { CLOSE_TOKEN, IToken } from './token';

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
