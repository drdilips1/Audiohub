// Images from plain-http hosts (e.g. an Audiobookshelf server on the LAN) are
// fetched through native HTTP on Android and shown as data URLs, because the
// WebView may refuse insecure / local-network image loads.
import { useEffect, useState } from 'preact/hooks';
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { abs } from './store.js';

const cache = new Map();
const native = Capacitor.isNativePlatform();

const isAbs = (url) => {
  const { server, altServer, token } = abs.get();
  return !!(token && ((server && url.startsWith(server)) || (altServer && url.startsWith(altServer))));
};

export function needsProxy(url) {
  return native && !!url && (/^http:\/\//i.test(url) || isAbs(url));
}

export function loadImage(url) {
  if (!needsProxy(url)) return Promise.resolve(url);
  if (cache.has(url)) return cache.get(url);
  const headers = isAbs(url) ? { Authorization: `Bearer ${abs.get().token}` } : {};
  const p = CapacitorHttp.get({ url, headers, responseType: 'blob', connectTimeout: 15000, readTimeout: 20000 })
    .then((res) => {
      if (res.status >= 400 || !res.data) throw new Error('HTTP ' + res.status);
      const h = res.headers || {};
      const type = h['Content-Type'] || h['content-type'] || 'image/jpeg';
      return typeof res.data === 'string' && res.data.startsWith('data:') ? res.data : `data:${type.split(';')[0]};base64,${res.data}`;
    })
    .catch((e) => {
      cache.delete(url);
      throw e;
    });
  cache.set(url, p);
  return p;
}

export function useImage(url) {
  const [src, setSrc] = useState(needsProxy(url) ? null : url);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
    if (!needsProxy(url)) return setSrc(url);
    let alive = true;
    setSrc(null);
    loadImage(url)
      .then((s) => alive && setSrc(s))
      .catch(() => alive && setFailed(true));
    return () => (alive = false);
  }, [url]);
  return { src, failed };
}
