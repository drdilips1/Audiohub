// Two interchangeable audio engines with the same surface:
//  - native (Android): Media3/ExoPlayer via the InkwellPlayer plugin — plays
//    plain-http LAN servers, .m4b, huge files, in the background.
//  - html: an <audio> element, used in the browser preview.
import { Capacitor, registerPlugin } from '@capacitor/core';

const Native = registerPlugin('InkwellPlayer');
export const isNative = Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('InkwellPlayer');

/**
 * handlers: { time(pos, dur), playing(bool), waiting(), ready(), ended(), error(msg), remote(action) }
 */
export function createEngine(h) {
  return isNative ? nativeEngine(h) : htmlEngine(h);
}

function nativeEngine(h) {
  let pos = 0;
  let dur = 0;
  let playing = false;
  let wantPlay = false;
  const onSnap = (e) => {
    if (typeof e.position === 'number') pos = e.position;
    if (e.duration > 0) dur = e.duration;
    h.time(pos, dur);
  };
  Native.addListener('progress', onSnap);
  let suppressed = false;
  Native.addListener('state', (e) => {
    onSnap(e);
    if (e.buffering && e.playWhenReady) h.waiting();
    else h.ready();
    // Silenced by a phone call or another app taking the audio: show it as paused.
    const nowSuppressed = !!(e.suppressed && e.playWhenReady);
    if (nowSuppressed !== suppressed) {
      suppressed = nowSuppressed;
      h.interrupted?.(suppressed);
    }
    if (e.playing !== playing) {
      playing = e.playing;
      // A pause caused by buffering isn't a user pause.
      if (playing || !e.playWhenReady || e.ended || suppressed) h.playing(playing);
    }
  });
  Native.addListener('ended', () => {
    playing = false;
    h.ended();
  });
  Native.addListener('error', (e) => {
    playing = false;
    h.error(e.message || e.code || 'Playback failed');
  });
  Native.addListener('remote', (e) => h.remote(e.action));

  return {
    async load(url, { start = 0, autoplay = true, headers, meta = {}, rate = 1 } = {}) {
      pos = start;
      dur = 0;
      wantPlay = autoplay;
      await Native.load({ url, headers: headers || {}, position: start, autoplay, rate, ...meta });
    },
    play: () => ((wantPlay = true), Native.play()),
    pause: () => ((wantPlay = false), Native.pause()),
    seek(t) {
      pos = Math.max(0, t);
      h.time(pos, dur);
      return Native.seek({ position: pos });
    },
    setRate: (rate) => Native.setRate({ rate }),
    setVolume: (volume) => Native.setVolume({ volume }),
    stop: () => ((wantPlay = false), Native.stop()),
    get time() {
      return pos;
    },
    get duration() {
      return dur;
    },
    get paused() {
      return !wantPlay;
    },
  };
}

function htmlEngine(h) {
  const a = new Audio();
  a.preload = 'auto';
  a.addEventListener('playing', () => (h.ready(), h.playing(true)));
  a.addEventListener('pause', () => h.playing(false));
  a.addEventListener('waiting', () => h.waiting());
  a.addEventListener('canplay', () => h.ready());
  a.addEventListener('loadedmetadata', () => h.time(a.currentTime, a.duration || 0));
  a.addEventListener('timeupdate', () => h.time(a.currentTime, a.duration || 0));
  a.addEventListener('ended', () => h.ended());
  a.addEventListener('error', () => {
    if (!a.getAttribute('src')) return;
    const code = a.error?.code;
    h.error(code === 4 ? 'This browser cannot play this file or link' : a.error?.message || 'Could not load this audio stream');
  });

  // Browser media keys / lock screen.
  const ms = navigator.mediaSession;
  if (ms) {
    const set = (k, fn) => {
      try {
        ms.setActionHandler(k, fn);
      } catch {}
    };
    set('play', () => a.play());
    set('pause', () => a.pause());
    set('seekbackward', () => h.remote('previous'));
    set('seekforward', () => h.remote('next'));
    set('previoustrack', () => h.remote('previous'));
    set('nexttrack', () => h.remote('next'));
    set('seekto', (d) => d?.seekTime != null && (a.currentTime = d.seekTime));
  }

  return {
    async load(url, { start = 0, autoplay = true, meta = {}, rate = 1 } = {}) {
      a.src = url;
      a.playbackRate = rate;
      if (start > 0) {
        const seekOnce = () => {
          a.currentTime = start;
          a.removeEventListener('loadedmetadata', seekOnce);
        };
        a.addEventListener('loadedmetadata', seekOnce);
      }
      if (ms && window.MediaMetadata) {
        ms.metadata = new MediaMetadata({
          title: meta.title,
          artist: meta.artist,
          album: meta.album,
          artwork: meta.artwork ? [{ src: meta.artwork, sizes: '512x512' }] : [],
        });
      }
      if (autoplay) await a.play();
    },
    play: () => a.play(),
    pause: () => a.pause(),
    seek(t) {
      a.currentTime = Math.max(0, Math.min(t, (a.duration || t + 1) - 0.25));
      h.time(a.currentTime, a.duration || 0);
    },
    setRate: (r) => (a.playbackRate = r),
    setVolume: (v) => (a.volume = v),
    stop() {
      a.pause();
      a.removeAttribute('src');
      a.load();
    },
    get time() {
      return a.currentTime;
    },
    get duration() {
      return a.duration || 0;
    },
    get paused() {
      return a.paused;
    },
  };
}
