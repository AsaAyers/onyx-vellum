/**
 * Decode a raw Buffer to a UTF-8 string, transparently handling UTF-16
 * encoded files (with or without BOM) so they can be processed by the
 * remark pipeline.
 *
 * Recognised encodings:
 *   FF FE …  — UTF-16 LE with BOM
 *   FE FF …  — UTF-16 BE with BOM
 *   <no BOM> — Heuristic: if every odd-indexed byte in the first 512 bytes
 *              is 0x00, the file is almost certainly BOM-less UTF-16 LE.
 *              Normal UTF-8 Markdown never contains embedded null bytes, so
 *              false positives are not a practical concern.
 */
export function decodeBuffer(rawBuffer: Buffer): {
  content: string;
  wasUtf16: boolean;
} {
  if (rawBuffer[0] === 0xff && rawBuffer[1] === 0xfe) {
    // UTF-16 LE with BOM: skip the 2-byte BOM, then decode the rest.
    return { content: rawBuffer.slice(2).toString("utf16le"), wasUtf16: true };
  }

  if (rawBuffer[0] === 0xfe && rawBuffer[1] === 0xff) {
    // UTF-16 BE with BOM: swap bytes before decoding as UTF-16 LE.
    const swapped = Buffer.alloc(rawBuffer.length - 2);
    for (let i = 2; i < rawBuffer.length - 1; i += 2) {
      swapped[i - 2] = rawBuffer[i + 1];
      swapped[i - 1] = rawBuffer[i];
    }
    return { content: swapped.toString("utf16le"), wasUtf16: true };
  }

  // Heuristic BOM-less UTF-16 LE detection: sample the first 512 bytes and
  // check whether every byte at an odd index is 0x00.  Require at least 4
  // bytes so a file that is just a single newline isn't mis-detected.
  const sampleLen = Math.min(rawBuffer.length, 512);
  let isBomlessUtf16Le = sampleLen >= 4;
  for (let i = 1; i < sampleLen; i += 2) {
    if (rawBuffer[i] !== 0x00) {
      isBomlessUtf16Le = false;
      break;
    }
  }
  if (isBomlessUtf16Le) {
    return { content: rawBuffer.toString("utf16le"), wasUtf16: true };
  }

  return { content: rawBuffer.toString("utf-8"), wasUtf16: false };
}
