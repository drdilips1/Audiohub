// The choice after tapping a StoryShots "S": play their narrated summary (their free
// podcast) here, hear or read their written summary here, or open StoryShots.
import { useEffect, useState } from 'preact/hooks';
import { Icon } from './icons.jsx';
import { nav, useBackClose } from '../lib/nav.js';
import * as player from '../lib/player.js';
import { registerChooser, storyShotsBook, storyShotsEpisodeBook, openStoryShots, checkStoryShots } from '../sources/storyshots.js';

const mins = (s) => (s > 0 ? ` · ${Math.round(s / 60)} min` : '');

export function StoryShotsSheet() {
  const [pick, setPick] = useState(null);
  useEffect(() => {
    registerChooser(setPick);
    return () => registerChooser(null);
  }, []);
  const [found, setFound] = useState('');
  useEffect(() => {
    setFound('');
    // From a cover only the podcast is known: look for the written summary too.
    if (pick && !pick.url) checkStoryShots(pick.book).then((u) => u && setFound(u));
  }, [pick]);
  useBackClose(!!pick, () => setPick(null));
  if (!pick) return null;
  const close = () => setPick(null);
  const { book, ep } = pick;
  const url = pick.url || found;
  const openBlock = (main) => (
    <>
      <button
        class={'btn big ' + (main ? 'primary' : 'secondary')}
        onClick={() => {
          close();
          openStoryShots(url);
        }}
      >
        <Icon name="external" size={18} /> {main ? 'Listen in StoryShots' : 'Open StoryShots'}
      </button>
      <small class="muted">{main ? 'Opens the StoryShots app — their narrated audio for this one is there, with your subscription.' : 'The StoryShots app, with your account (PDFs, infographics, the full library).'}</small>
    </>
  );
  return (
    <div class="sheet-backdrop" onClick={close}>
      <div class="sheet ss-sheet" onClick={(e) => e.stopPropagation()}>
        <div class="sheet-handle" />
        <h3>
          <span class="ss-badge">S</span> {book.title} on StoryShots
        </h3>
        {ep && (
          <>
            <button
              class="btn primary big"
              onClick={() => {
                close();
                player.playBook(storyShotsEpisodeBook(ep));
              }}
            >
              <Icon name="play" size={18} /> Play StoryShots audio{mins(ep.duration)}
            </button>
            <small class="muted">Their own narrated summary (from their free podcast), in the Audiohub player.</small>
          </>
        )}
        {!ep && openBlock(true)}
        {url && (
          <>
            <button
              class="btn secondary big"
              onClick={() => {
                close();
                nav.push('reader', { book: storyShotsBook(book, url), readAloud: true });
              }}
            >
              <Icon name="headphones" size={18} /> Hear the written summary
            </button>
            <button
              class="btn secondary big"
              onClick={() => {
                close();
                nav.push('reader', { book: storyShotsBook(book, url) });
              }}
            >
              <Icon name="book" size={18} /> Read it here
            </button>
          </>
        )}
        {ep && openBlock(false)}
      </div>
    </div>
  );
}
