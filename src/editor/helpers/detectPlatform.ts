enum Platform {
  PC,
  Mac,
}

/**
 * Crude way to detect the underlying platform as
 * Mac or PC (not Mac).
 */
export default function detectPlatform(): Platform {
  if (['Macintosh', 'MacIntel', 'MacPPC', 'Mac68K'].includes(navigator.platform)) {
    return Platform.Mac;
  }
  return Platform.PC;
}
