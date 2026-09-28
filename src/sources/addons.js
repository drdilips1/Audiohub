// Community catalog addons speaking the Stremio addon protocol
// (manifest.json + /catalog, /meta, /stream). Install any addon by URL.
import { getJson, cleanUrl } from '../lib/http.js';
import { addons } from '../lib/store.js';
import { isSourceManifest } from './sourceaddons.js';

// Addons that no longer work (their server blocks every search) are removed on update.
const RETIRED = /anna'?s?[\s_-]*archive|^annas?$/i;
const isRetired = (a) => RETIRED.test(a?.manifest?.id || '') || RETIRED.test(a?.manifest?.name || '');
const prune = (list) => list.some(isRetired) && addons.set(list.filter((a) => !isRetired(a)));
prune(addons.get());
addons.subscribe(prune); // also catches copies restored from sync

export function normalizeUrl(u) {
  return cleanUrl(String(u || '').trim().replace(/^stremio:\/\//i, 'https://'));
}

const baseOf = (addon) => (addon.base || addon.url.replace(/\/manifest\.json(\?.*)?$/, '')).replace(/\/+$/, '');
const enc = encodeURIComponent;
const isManifest = (m) => m && typeof m === 'object' && m.id && m.name && (m.resources || m.catalogs);

// Where the addon's /catalog, /meta and /stream routes live.
function resolveBase(url, manifest) {
  const hint = manifest.transportUrl || manifest.baseUrl || manifest.endpoint || manifest.url;
  if (typeof hint === 'string' && /^https?:\/\//i.test(hint)) return hint.replace(/\/manifest\.json(\?.*)?$/, '');
  return url.replace(/\/manifest\.json(\?.*)?$/, '');
}

function save(url, manifest) {
  const entry = { url, base: resolveBase(url, manifest), manifest };
  addons.set((list) => [...list.filter((a) => a.manifest.id !== manifest.id), entry]);
  return manifest;
}

/**
 * Install from any link: a Stremio-style manifest URL (with or without
 * "/manifest.json"), a JSON file hosted anywhere (jsonkeeper, gist, pastebin raw…)
 * that contains a manifest, or an addon collection ([{ transportUrl, manifest }]).
 */
export async function install(rawUrl) {
  const url = normalizeUrl(rawUrl);
  if (!/^https?:\/\//i.test(url)) throw new Error('Enter an http(s) link to the addon');
  const candidates = /manifest\.json(\?.*)?$/.test(url) ? [url] : [url, url.replace(/\/+$/, '') + '/manifest.json'];
  let lastErr = null;
  for (const u of candidates) {
    let data;
    try {
      data = await getJson(u, { fresh: true });
    } catch (e) {
      lastErr = e;
      continue;
    }
    if (isManifest(data)) return save(u, data);
    if (isSourceManifest(data)) {
      addons.set((list) => [...list.filter((a) => a.manifest.id !== data.id), { kind: 'source', url: u, manifest: data }]);
      return data;
    }
    const list = Array.isArray(data) ? data : Array.isArray(data?.addons) ? data.addons : null;
    if (list) {
      const installed = [];
      for (const item of list) {
        try {
          if (typeof item === 'string') installed.push(await install(item));
          else if (isManifest(item?.manifest) && item.transportUrl) installed.push(save(item.transportUrl, item.manifest));
          else if (item?.transportUrl) installed.push(await install(item.transportUrl));
          else if (isManifest(item)) installed.push(save(u, item));
          else if (isSourceManifest(item)) {
            addons.set((l) => [...l.filter((a) => a.manifest.id !== item.id), { kind: 'source', url: u, manifest: item }]);
            installed.push(item);
          }
        } catch {}
      }
      if (installed.length) return { name: `${installed.length} addon${installed.length > 1 ? 's' : ''}`, id: installed[0].id };
    }
    const keys = data && typeof data === 'object' ? Object.keys(data).slice(0, 6).join(', ') : typeof data;
    lastErr = new Error(`This addon uses a format Inkwell doesn't support yet (it has: ${keys || 'nothing'}).`);
    lastErr.raw = data;
    break;
  }
  throw lastErr || new Error('Could not load that addon');
}

export const count = () => addons.get().length;

export function uninstall(id) {
  addons.set((list) => list.filter((a) => a.manifest.id !== id));
}

const hasResource = (m, name) => (m.resources || []).some((r) => (typeof r === 'string' ? r : r.name) === name);

function toBook(addon, meta) {
  return {
    uid: `addon:${addon.manifest.id}|${meta.type}|${meta.id}`,
    source: 'addon',
    addonName: addon.manifest.name,
    kind: 'audio',
    title: meta.name,
    author: [].concat(meta.director || meta.cast || meta.author || []).slice(0, 2).join(', ') || meta.releaseInfo || '',
    cover: meta.poster || meta.logo || meta.background || '',
    year: meta.releaseInfo || meta.year || '',
    description: meta.description || '',
  };
}

// Rows for the home screen: every catalog that needs no mandatory extras.
export async function catalogRows() {
  const rows = [];
  for (const a of addons.get().filter((x) => x.kind !== 'source')) {
    for (const c of a.manifest.catalogs || []) {
      const required = (c.extra || []).some((e) => e.isRequired) || (c.extraRequired || []).length;
      if (required) continue;
      rows.push({
        key: `${a.manifest.id}/${c.type}/${c.id}`,
        title: c.name || `${a.manifest.name} · ${c.type}`,
        subtitle: a.manifest.name,
        load: async () => {
          const data = await getJson(`${baseOf(a)}/catalog/${enc(c.type)}/${enc(c.id)}.json`);
          return (data.metas || []).map((m) => toBook(a, m));
        },
      });
    }
  }
  return rows;
}

export async function search(term) {
  const out = [];
  await Promise.all(
    addons.get().filter((x) => x.kind !== 'source').flatMap((a) =>
      (a.manifest.catalogs || [])
        .filter((c) => (c.extra || []).some((e) => e.name === 'search') || (c.extraSupported || []).includes('search'))
        .map(async (c) => {
          try {
            const data = await getJson(`${baseOf(a)}/catalog/${enc(c.type)}/${enc(c.id)}/search=${enc(term)}.json`);
            out.push(...(data.metas || []).map((m) => toBook(a, m)));
          } catch {}
        })
    )
  );
  const seen = new Set();
  return out.filter((b) => !seen.has(b.uid) && seen.add(b.uid));
}

function parseUid(uid) {
  const [addonId, type, ...rest] = uid.slice(6).split('|');
  const addon = addons.get().find((a) => a.manifest.id === addonId);
  if (!addon) throw new Error('This addon is no longer installed');
  return { addon, type, id: rest.join('|') };
}

async function streams(addon, type, id) {
  const data = await getJson(`${baseOf(addon)}/stream/${enc(type)}/${enc(id)}.json`, { fresh: true, timeout: 45000 });
  return (data.streams || []).filter((s) => s.url);
}

export async function details(book) {
  const { addon, type, id } = parseUid(book.uid);
  let meta = null;
  if (hasResource(addon.manifest, 'meta')) {
    try {
      meta = (await getJson(`${baseOf(addon)}/meta/${enc(type)}/${enc(id)}.json`)).meta;
    } catch {}
  }
  const b = meta ? { ...book, ...toBook(addon, meta), uid: book.uid } : book;
  const videos = (meta?.videos || [])
    .slice()
    .sort((x, y) => (x.season || 0) - (y.season || 0) || (x.episode ?? x.number ?? 0) - (y.episode ?? y.number ?? 0));
  if (videos.length) {
    return {
      ...b,
      tracks: videos.map((v, i) => ({
        title: v.title || v.name || `Part ${i + 1}`,
        index: i,
        resolve: async () => (await streams(addon, type, v.id))[0]?.url,
      })),
    };
  }
  // Single-item meta: each stream becomes a selectable version.
  return {
    ...b,
    tracks: null,
    resolveTracks: async () => {
      const list = await streams(addon, type, id);
      if (!list.length) throw new Error('The addon returned no playable streams');
      return { tracks: list.map((s, i) => ({ title: s.title || s.name || `Stream ${i + 1}`, url: s.url, index: i })) };
    },
  };
}
