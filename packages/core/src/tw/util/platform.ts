export type IPlatform = 'Linux' | 'macOS' | 'Windows' | 'Unknown';

export function detectPlatform(): IPlatform {
    if (navigator.platform.startsWith('Linux')) {
        return 'Linux';
    }
    if (['Windows', 'Win16', 'Win32'].includes(navigator.platform)) {
        return 'Windows';
    }
    if (['Macintosh', 'MacIntel', 'MacPPC', 'Mac68K'].includes(navigator.platform)) {
        return 'macOS';
    }
    return 'Unknown';
}
