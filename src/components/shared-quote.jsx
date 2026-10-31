// A quote someone shared with you (an audiohub link): read it, or go to that moment in
// your copy of the book. Without the book, find it first — once it plays, the app offers
// to jump to the quote.
import { useEffect, useState } from 'preact/hooks';
import { Icon } from './icons.jsx';
import { Cover, toast } from './common.jsx';
import { useStore } from '../lib/store.js';
import { shareRequest, cardStyle, quoteCard, sendQuote, CARD_STYLES } from '../lib/quoteshare.js';
import { nav } from '../lib/nav.js';
import * as player from '../lib/player.js';
import { getDetails } from '../sources/index.js';
import { sharedQuote, findMine, atLabel, pendingFor, clearPending } from '../lib/quoteshare.js';

export function SharedQuoteSheet() {
  const { open, pending } = useStore(sharedQuote);
  const [busy, setBusy] = useState(false);
  const [offer, setOffer] = useState(null); // the pending quote, when its book starts playing
  // Book playing that a shared quote was waiting for: offer to jump there.
  useEffect(
    () =>
      player.subscribe((s) => {
        if (!s.book || !s.tracks?.length) return;
        const p = pendingFor(s.book);
        if (p && p.kind === 'audio' && p.global != null) setOffer((o) => o || p);
      }),
    [pending]
  );
  const close = () => sharedQuote.set((s) => ({ ...s, open: null }));
  const q = open;
  const mine = q ? findMine(q) : null;
  const at = q ? atLabel(q) : '';
  const go = async () => {
    if (!mine) {
      // Find the book; the quote waits until you have it.
      sharedQuote.set({ open: null, pending: q });
      nav.tab('discover');
      setTimeout(() => import('../screens/Discover.jsx').then((m) => m.openSearch(`${q.title} ${q.author}`.trim())), 200);
      toast('Get the book — then the app offers to jump to the quote');
      return;
    }
    if (q.kind === 'text') {
      sharedQuote.set({ open: null, pending: q });
      return nav.push('reader', { book: mine });
    }
    setBusy(true);
    try {
      const details = await getDetails(mine);
      close();
      nav.openOverlay('player');
      await player.playBook(details, { globalStart: q.global ?? undefined });
    } catch (e) {
      toast(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {q && (
        <div class="sheet-backdrop" onClick={close}>
          <div class="sheet shared-quote" onClick={(e) => e.stopPropagation()}>
            <div class="sheet-handle" />
            <small class="sq-kicker">Shared quote{at ? ` · ${at}` : ''}</small>
            <p class="sq-quote">“{q.quote}”</p>
            {q.note && <p class="sq-note">{q.note}</p>}
            <div class="sq-book">
              <Cover book={{ title: q.title, author: q.author, cover: q.cover }} />
              <span>
                <b>{q.title}</b>
                <small>
                  {q.author}
                  {q.kind === 'text' ? ' · ebook' : at ? ` · audiobook at ${at}` : ''}
                </small>
              </span>
            </div>
            <div class="sq-actions">
              <button class="btn primary" disabled={busy} onClick={go}>
                {busy ? <span class="spinner" /> : <Icon name={mine ? (q.kind === 'text' ? 'book' : 'play') : 'download'} size={16} />}{' '}
                {mine ? (q.kind === 'text' ? 'Open at this passage' : `Play from ${at || 'here'}`) : 'Get the book'}
              </button>
              <button class="btn secondary" onClick={close}>
                Just read
              </button>
            </div>
            {!mine && <p class="sq-hint">Once it's on your phone, “Jump to the shared quote” appears when you play it.</p>}
          </div>
        </div>
      )}
      {offer && (
        <div class="sheet-backdrop" onClick={() => setOffer(null)}>
          <div class="sheet shared-quote" onClick={(e) => e.stopPropagation()}>
            <div class="sheet-handle" />
            <small class="sq-kicker">Shared quote · {atLabel(offer)}</small>
            <p class="sq-quote small">“{offer.quote}”</p>
            <div class="sq-actions">
              <button
                class="btn primary"
                onClick={() => {
                  player.seekGlobal(offer.global);
                  clearPending();
                  setOffer(null);
                }}
              >
                <Icon name="play" size={16} /> Jump to the shared quote
              </button>
              <button
                class="btn secondary"
                onClick={() => {
                  clearPending();
                  setOffer(null);
                }}
              >
                Not now
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const STYLE_NAMES = { paper: 'Paper', cover: 'Cover colours', night: 'Night' };

/** Sharing a quote: pick the card's look (a live preview), then share the picture — or just the text. */
export function ShareQuoteSheet() {
  const q = useStore(shareRequest);
  const style = useStore(cardStyle);
  const [card, setCard] = useState(null); // { data, cut } for the look shown
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!q) return;
    let live = true;
    setCard(null);
    quoteCard(q, style)
      .then((c) => live && setCard(c))
      .catch(() => live && setCard({ data: '', cut: true }));
    return () => (live = false);
  }, [q, style]);
  if (!q) return null;
  const close = () => shareRequest.set(null);
  const send = async (withPicture) => {
    setBusy(true);
    try {
      const r = await sendQuote(q, withPicture && card?.data ? card : null);
      if (r === 'copied') toast('Copied — paste it anywhere');
      close();
    } catch (e) {
      toast(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div class="sheet-backdrop" onClick={close}>
      <div class="sheet share-quote" onClick={(e) => e.stopPropagation()}>
        <div class="sheet-handle" />
        <h3>Share quote</h3>
        <div class="sq-preview">{card?.data ? <img src={`data:image/jpeg;base64,${card.data}`} alt="Quote card" /> : <span class="spinner" />}</div>
        <div class="chips sq-styles">
          {CARD_STYLES.map((k) => (
            <button class={'pill small' + (style === k ? ' active' : '')} onClick={() => cardStyle.set(k)}>
              {STYLE_NAMES[k]}
            </button>
          ))}
        </div>
        {card?.cut && <p class="sq-hint">Too long for the picture, so it's shortened there — the full text goes with it in the message.</p>}
        <div class="sq-actions">
          <button class="btn primary" disabled={busy || !card?.data} onClick={() => send(true)}>
            {busy ? <span class="spinner" /> : <Icon name="upload" size={16} />} Share picture
          </button>
          <button class="btn secondary" disabled={busy} onClick={() => send(false)}>
            Share as text
          </button>
        </div>
      </div>
    </div>
  );
}
