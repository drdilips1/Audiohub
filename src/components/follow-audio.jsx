// The ebook open while its audiobook plays: light up the paragraph being heard and keep it
// on screen (like Kindle's Whispersync). Found by the words the phone recognises, so it
// works with any edition of the ebook; reading on your own pauses the scrolling a while.
import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from './icons.jsx';
import * as player from '../lib/player.js';
import { sameWork } from '../lib/works.js';
import { blockText } from '../lib/tts.js';

export function FollowAudio({ book, blocks, scroller, ready }) {
  const [ps, setPs] = useState(player.getState());
  useEffect(() => player.subscribe(setPs), []);
  const [on, setOn] = useState(false);
  const [status, setStatus] = useState('');
  const index = useRef(null);
  const near = useRef(null);
  const lit = useRef(null);
  const touched = useRef(0);
  const playing = ps.book && ps.book.kind !== 'text' && ps.book.uid !== book.uid && sameWork(ps.book, book);

  // You scrolling yourself: leave the page alone for a few seconds.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const mark = () => (touched.current = Date.now());
    el.addEventListener('touchstart', mark, { passive: true });
    el.addEventListener('wheel', mark, { passive: true });
    return () => (el.removeEventListener('touchstart', mark), el.removeEventListener('wheel', mark));
  }, [ready]);

  useEffect(() => {
    if (!on || !playing || !ready) return;
    let alive = true;
    let tr = null;
    let bt = null;
    let quiet = 0;
    (async () => {
      [tr, bt] = await Promise.all([import('../lib/transcript.js'), import('../lib/booktext.js')]);
      if (!alive) return;
      if (!tr.transcriptAvailable) return setStatus('Needs speech recognition (Android app, Settings → Text)');
      tr.followInReader(true);
      setStatus('Listening for where you are…');
    })();
    const tick = setInterval(() => {
      if (!tr || !bt || !alive) return;
      const list = blocks();
      if (!list.length) return;
      if (!index.current || index.current.n !== list.length) index.current = { n: list.length, w: bt.wordIndex(list.map((el) => blockText(el))) };
      const heard = tr.heardNow();
      if (!heard) {
        if (++quiet > 12 && player.getState().playing) setStatus('Waiting for speech… (the phone is still recognising it)');
        return;
      }
      const w = index.current.w;
      const r = bt.locate(w, heard, near.current);
      if (!r) return;
      quiet = 0;
      near.current = r.to;
      const el = list[bt.paraOf(w, r.to - 1)];
      if (!el) return;
      setStatus('');
      if (lit.current !== el) {
        lit.current?.classList.remove('listen-now');
        el.classList.add('listen-now');
        lit.current = el;
      }
      // Keep it in view (unless you've been scrolling yourself just now).
      const box = scroller.current?.getBoundingClientRect();
      const b = el.getBoundingClientRect();
      if (box && Date.now() - touched.current > 6000 && (b.top < box.top + 60 || b.bottom > box.bottom - 120)) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 1200);
    return () => {
      alive = false;
      clearInterval(tick);
      tr?.followInReader(false);
      lit.current?.classList.remove('listen-now');
      lit.current = null;
    };
  }, [on, playing, ready]);

  if (!playing) return null;
  return (
    <div class={'follow-audio' + (on ? ' on' : '')}>
      <button class="pill small" onClick={() => setOn(!on)}>
        <Icon name="headphones" size={14} /> {on ? 'Following the audio' : 'Follow the audio'}
      </button>
      {on && status && <small>{status}</small>}
    </div>
  );
}
