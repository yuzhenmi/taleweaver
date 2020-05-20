import crypto from 'crypto';

const bytes16 = new Uint8Array(16);

function generateRandomBytes16() {
    return crypto.randomFillSync(bytes16);
}

export function generateId() {
    return Buffer.from(String.fromCharCode(...Array.from(generateRandomBytes16()))).toString('base64');
}
