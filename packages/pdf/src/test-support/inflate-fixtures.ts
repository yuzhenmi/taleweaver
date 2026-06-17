/**
 * Reference dynamic-Huffman DEFLATE fixtures for inflate.ts (RFC 1951 §3.2.7).
 *
 * The in-package `deflate` emits only fixed-Huffman, so dynamic-Huffman DECODE
 * cannot be round-trip-tested against our own encoder. These are KNOWN-ANSWER
 * fixtures produced by a reference compressor (Node `zlib`, level 9) — each is
 * a verified DYNAMIC-Huffman stream (first block BTYPE=10). Bytes are pinned
 * (base64) so the tests need no runtime zlib. Do NOT regenerate casually; if you
 * must, confirm the first block is still BTYPE=10 (`(bytes[0] >> 1) & 3 === 2`).
 *
 * `raw` = raw DEFLATE (for `inflate`); `zlib` = RFC 1950 zlib-wrapped (for
 * `zlibDecompress`). Expected plaintext: `natural` = LOREM.repeat(8);
 * `backrefs` = the documented loop; `skewed` = an LCG-generated 3000-byte string
 * over a 12-symbol alphabet (asserted by length + Adler-32, value below).
 */

/** Decode a base64 string to bytes (Node Buffer-free, works under plain vitest). */
export function b64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 0xff;
  return out;
}

/** The LOREM unit; `natural` plaintext is LOREM.repeat(8). */
export const LOREM =
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. ";

/** `backrefs` plaintext: 300 iterations of `segment_${i%23}_data|`. */
export function backrefsPlaintext(): string {
  let s = "";
  for (let i = 0; i < 300; i++) s += "segment_" + (i % 23) + "_data|";
  return s;
}

export interface InflateFixture {
  readonly rawB64: string;   // raw DEFLATE stream (BTYPE=10 first block)
  readonly zlibB64: string;  // RFC 1950 zlib-wrapped form of the same data
  readonly plainLen: number; // decompressed length in bytes
}

export const NATURAL: InflateFixture = {
  rawB64: "7c/BbQMxDETRVqaAhSvxNQUwImEMIIq7Ehm4/GDjFnLUjQfiD94zpjl4rnJo9JhYTIhbHmgxlrW0rAlRnlyN4wXrzAPLFBow1vJQpPkZExyNSq2RqESX75gGy0/a4PIaAum8Sh74StigQxTO+/ixQfEDV3FhxMpZCnvbbExJxkD1Lt7iU76fuHgv/SV5wt4wQQv30PgArpJ84Lmd27md27md2/mPzl8=",
  zlibB64: "eNrtz8FtAzEMRNFWpoCFK/E1BTAiYQwgirsSGbj8YOMWctSNB+IP3jOmOXiucmj0mFhMiFseaDGWtbSsCVGeXI3jBevMA8sUGjDW8lCk+RkTHI1KrZGoRJfvmAbLT9rg8hoC6bxKHvhK2KBDFM77+LFB8QNXcWHEylkKe9tsTEnGQPUu3uJTvp+4eC/9JXnC3jBBC/fQ+ACuknzguZ3buZ3buZ3b+Y/OX0E7rRc=",
  plainLen: 1856,
};

export const BACKREFS: InflateFixture = {
  rawB64: "7dC5DYAwFATRllhzV2NZwiKCxA4pnoTkbwdIE042eq2eV717HvJRennal4qZYo4xp5hzzCXmGnOLuduGb9mXbEx2JluTvcnmZHeyPdlfsr/kbvaHMsooo4wyyiijjDLKKKOMMsooo/wz5Rc=",
  zlibB64: "eNrt0LkNgDAUBNGWWHNXY1nCIoLEDimehORvB0gTTjZ6rZ5XvXse8lF6edqXiplijjGnmHPMJeYac4u524Zv2ZdsTHYmW5O9yeZkd7I92V+yv+Ru9ocyyiijjDLKKKOMMsooo4wyyiij/DPlF56TIxc=",
  plainLen: 4669,
};

/** `skewed`: LCG-generated, not formula-reconstructable → asserted by length + Adler-32. */
export const SKEWED: InflateFixture & { readonly adler32: number } = {
  rawB64: "NVbtauxQCHxWwQEFUdA573+ZbO/+aDdtcqLzpQBYgHXZ9G4iCSs0jNhO33W445w4/cDCO33qVQLgPfCcFmN0FAgMgWJ1EjSbSQNwmBmavpouoD+PLwf6+Ot7GOg60ViM6drG7Fk2MIhKA7/D4UMscboXtox5dlOgwcEeGBt0zvXbGcZ70FOnZmI6MQ/dRDZ2IhxNYUBAJ4YKITiMw1Wq1WfbKj9hb/zOELRpK34dpE0FUZhtCweOgRNKjuwHJ4keE749A5gKwG5nTHNQE8C6QwgG6pbOnIQqnxsj854eKwzKLR84qpiHc+GoStYnyQO6TUwcF90z7THedgc1CvSA0aRADn60AOTYj54MW2Kogi3A2wTYr8vFxdxbg72PcKR/vCzhe88hUg1XK+KwECwLOE3C0ns8AFfBvbAM7LzHBzAFCw+TgE3kZeOMW8A7i+THUOey8Aygil/OgIl4F3iHFzpptlg7QAmK796+NW/mA6YpjUilS4nIwcisaEPo5sY9sa5Lb52I9LdPdYOIZygj/fHT93DeptTLBEPowPIjGoVbApaY6e/39xm44QjzEWS8MkF/n0OAeIBX10kVZXh7Q++1NWxF9421VG9nNIx4srt5GTAPV89cdXryXSNRP+gJ56oSKUu8cdAGG0auABhYspfxLGZU4xp4F4M09Ogs5Hz85b1ae95lZv3EVujsqfVgq3lw1BhlGb+UCEHz44dlSwr2ofhqgrEuZO6TTAx2qjx4rqqv9xnH00tSyLO5N53m6S/V//ZrjFS6jJSYU4hGXpj4efaICdhX5D68nI+MQXTpn0UJPtc+U5A+GObQRsZWLgA/y3x6dPc0K9WJGiKzxZ0lXr+DuXRklI9dcCNM6XgFHy+1jniKvBqb8gwmBwHUwo7C55nAMMwfk17iAcZnNmtt5IQdrmd7D5b1aC+6LjwlZw8mJhWNwVVfBda4qayH9ws1MY9mLvcTxgY+kdC4ilWTSr8I8ebnEbmfVSzaFeDNMaypK+cnk3kmZSBDchdgvFNTcOVCBh8mn0Xcz3b5+fPJA3b8gs2Z2Py8bO8Be34yUWteTMP87cEnBRP3mcsaym+Y7bP6hKbPdWDMCcNT+jv81ZeCwKWFSQBhbHYMYjQe3WHF39ldKfCa0/2lAGr5Bsh4mQxWpSINlUrx/nxnLHhPYIIbCA3Cbs0xJBebEy9/CWVOm8fk7vuGDerJZ9MDAbpM+eYgsMrHqrEvh6n845PjLlgoGCe+95fX43eWtcW1JKw5FPN008y4wL64L5Txrr8pbshVGmsak8JiUDY7fbiAuopswpRZinh7J4mIPDCJMVjJnPmd1aZ5k6nI7k00Q5GQ/7lBfEFczU9J0xIdbOc71PQi1ZLAtsyBUmj/Hi2Mpp1xX9Hezy7xpYrRxllGD6sBOyeOlbjNIGZkMvn75f2MHf6eKmET97ZgLftqFEsaUp7v2CkMMvHFeSv6owt2pjS1q6HWCo3H1RLg5ggzhtScstKXzrG5CPx0md9+JS2/4zcoNcozZSCUwmBN9nu+esd7hYcOb/Jl36dPmvsNXpqhvRC/E6BdYUoTNyuCJG1R8JuY5/wRcNJP/uLlXVit33ifA/alQ3xq0M6hPOr5zhZ+jqxRipbg+YwcaJcXclaJv5jr1qoyf2ugctdurbUgElFfyxqcy/q2CLWAedpoUuN69SQr5J0oichOb0r7VpHACYHfeDUePrIG/g2TNrx4L/0itON8xU5eOY2ZL0zD+6CtLQrTyT85p1R8raXKKlUv13RAaTBuzzBPFi5CGosZzmZot1FL822tm1vaerOVkd9yBEWt9k6ZHPmUjLOIvz0pC6/ceDY+kqadBmHaPw==",
  zlibB64: "eNo1Vu1q7FAIfFbBAQVR0Dnvf5ls7/5oN21yovOlAFiAddn0biIJKzSM2E7fdbjjnDj9wMI7fepVAuA98JwWY3QUCAyBYnUSNJtJA3CYGZq+mi6gP48vB/r463sY6DrRWIzp2sbsWTYwiEoDv8PhQyxxuhe2jHl2U6DBwR4YG3TO9dsZxnvQU6dmYjoxD91ENnYiHE1hQEAnhgohOIzDVarVZ9sqP2Fv/M4QtGkrfh2kTQVRmG0LB46BE0qO7AcniR4Tvj0DmArAbmdMc1ATwLpDCAbqls6chCqfGyPznh4rDMotHziqmIdz4ahK1ifJA7pNTBwX3TPtMd52BzUK9IDRpEAOfrQA5NiPngxbYqiCLcDbBNivy8XF3FuDvY9wpH+8LOF7zyFSDVcr4rAQLAs4TcLSezwAV8G9sAzsvMcHMAULD5OATeRl44xbwDuL5MdQ57LwDKCKX86AiXgXeIcXOmm2WDtACYrv3r41b+YDpimNSKVLicjByKxoQ+jmxj2xrktvnYj0t091g4hnKCP98dP3cN6m1MsEQ+jA8iMahVsClpjp7/f3GbjhCPMRZLwyQX+fQ4B4gFfXSRVleHtD77U1bEX3jbVUb2c0jHiyu3kZMA9Xz1x1evJdI1E/6AnnqhIpS7xx0AYbRq4AGFiyl/EsZlTjGngXgzT06CzkfPzlvVp73mVm/cRW6Oyp9WCreXDUGGUZv5QIQfPjh2VLCvah+GqCsS5k7pNMDHaqPHiuqq/3GcfTS1LIs7k3nebpL9X/9muMVLqMlJhTiEZemPh59ogJ2FfkPrycj4xBdOmfRQk+1z5TkD4Y5tBGxlYuAD/LfHp09zQr1YkaIrPFnSVev4O5dGSUj11wI0zpeAUfL7WOeIq8GpvyDCYHAdTCjsLnmcAwzB+TXuIBxmc2a23khB2uZ3sPlvVoL7ouPCVnDyYmFY3BVV8F1riprIf3CzUxj2Yu9xPGBj6R0LiKVZNKvwjx5ucRuZ9VLNoV4M0xrKkr5yeTeSZlIENyF2C8U1Nw5UIGHyafRdzPdvn588kDdvyCzZnY/Lxs7wF7fjJRa15Mw/ztwScFE/eZyxrKb5jts/qEps91YMwJw1P6O/zVl4LApYVJAGFsdgxiNB7dYcXf2V0p8JrT/aUAavkGyHiZDFalIg2VSvH+fGcseE9gghsIDcJuzTEkF5sTL38JZU6bx+Tu+4YN6sln0wMBukz55iCwyseqsS+Hqfzjk+MuWCgYJ773l9fjd5a1xbUkrDkU83TTzLjAvrgvlPGuvyluyFUaaxqTwmJQNjt9uIC6imzClFmKeHsniYg8MIkxWMmc+Z3VpnmTqcjuTTRDkZD/uUF8QVzNT0nTEh1s5zvU9CLVksC2zIFSaP8eLYymnXFf0d7PLvGlitHGWUYPqwE7J46VuM0gZmQy+fvl/Ywd/p4qYRP3tmAt+2oUSxpSnu/YKQwy8cV5K/qjC3amNLWrodYKjcfVEuDmCDOG1Jyy0pfOsbkI/HSZ334lLb/jNyg1yjNlIJTCYE32e756x3uFhw5v8mXfp0+a+w1emqG9EL8ToF1hShM3K4IkbVHwm5jn/BFw0k/+4uVdWK3feJ8D9qVDfGrQzqE86vnOFn6OrFGKluD5jBxolxdyVom/mOvWqjJ/a6By126ttSASUV/LGpzL+rYItYB52mhS43r1JCvknSiJyE5vSvtWkcAJgd94NR4+sgb+DZM2vHgv/SK043zFTl45jZkvTMP7oK0tCtPJPzmnVHytpcoqVS/XdEBpMG7PME8WLkIaixnOZmi3UUvzba2bW9p6s5WR33IERa32Tpkc+ZSMs4i/PSkLr9x4Nj6Spp0GYdo/67ffRQ==",
  plainLen: 3000,
  adler32: 3954696005, // 0xebb7df45, computed over the decompressed bytes
};
