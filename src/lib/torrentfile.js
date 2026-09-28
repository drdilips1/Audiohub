// Reading a .torrent file: its name and info-hash (SHA-1 of the bencoded
// "info" dictionary), so it can be tracked like a magnet.

/** Index just past the bencoded value that starts at i. */
function skip(b, i) {
  const c = b[i];
  if (c === 0x69) return b.indexOf(0x65, i) + 1; // i…e
  if (c === 0x6c || c === 0x64) {
    // l…e / d…e
    i++;
    while (b[i] !== 0x65) i = skip(b, i);
    return i + 1;
  }
  // <len>:<bytes>
  const colon = b.indexOf(0x3a, i);
  const len = parseInt(new TextDecoder().decode(b.subarray(i, colon)), 10);
  return colon + 1 + len;
}

function readString(b, i) {
  const colon = b.indexOf(0x3a, i);
  const len = parseInt(new TextDecoder().decode(b.subarray(i, colon)), 10);
  return [b.subarray(colon + 1, colon + 1 + len), colon + 1 + len];
}

/** { name, hash } from a .torrent file's bytes (hash '' if it can't be read). */
export async function readTorrent(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b[0] !== 0x64) throw new Error("That isn't a .torrent file");
  let i = 1;
  let info = null;
  while (i < b.length && b[i] !== 0x65) {
    const [key, next] = readString(b, i);
    const end = skip(b, next);
    if (new TextDecoder().decode(key) === 'info') info = [next, end];
    i = end;
  }
  if (!info) throw new Error("That isn't a .torrent file");
  let name = '';
  // name inside info
  let j = info[0] + 1;
  while (j < info[1] - 1 && b[j] !== 0x65) {
    const [key, next] = readString(b, j);
    const end = skip(b, next);
    if (new TextDecoder().decode(key) === 'name') name = new TextDecoder().decode(readString(b, next)[0]);
    j = end;
  }
  let hash = '';
  try {
    const d = await crypto.subtle.digest('SHA-1', b.subarray(info[0], info[1]));
    hash = [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
  } catch {}
  return { name, hash };
}

/** Let the user pick a .torrent file; resolves with the File, or null. */
export function pickTorrentFile() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    // No strict filter: phones often don't know the .torrent type and would grey the files out.
    input.accept = '.torrent,application/x-bittorrent,application/octet-stream,*/*';
    input.onchange = () => resolve(input.files?.[0] || null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}
