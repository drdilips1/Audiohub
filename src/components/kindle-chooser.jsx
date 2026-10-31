// "Which Kindle?" — asked by Send to Kindle when there's more than one Kindle address
// (or Gmail sender) in Settings → Send to Kindle.
import { useEffect, useState } from 'preact/hooks';
import { Icon } from './icons.jsx';
import { setKindleAsker } from '../lib/kindle.js';

export function KindleChooser() {
  const [ask, setAsk] = useState(null); // { targets, senders, done }
  const [sender, setSender] = useState(0);
  useEffect(() => {
    setKindleAsker(
      (opts) =>
        new Promise((done) => {
          setSender(0);
          setAsk({ ...opts, done });
        })
    );
    return () => setKindleAsker(null);
  }, []);
  if (!ask) return null;
  const finish = (value) => {
    ask.done(value);
    setAsk(null);
  };
  const s = ask.senders[sender];
  return (
    <div class="sheet-backdrop" onClick={() => finish(null)}>
      <div class="sheet kindle-chooser" onClick={(e) => e.stopPropagation()}>
        <div class="sheet-handle" />
        <h3>Send to which Kindle?</h3>
        <div class="kindle-list">
          {ask.targets.map((t) => (
            <button class="kindle-pick" onClick={() => finish({ to: [t.email], label: t.name, sender: s })}>
              <Icon name="book" size={18} />
              <span>
                <b>{t.name}</b>
                <small>{t.email}</small>
              </span>
            </button>
          ))}
          {ask.targets.length > 1 && (
            <button class="kindle-pick all" onClick={() => finish({ to: ask.targets.map((t) => t.email), label: `all ${ask.targets.length} Kindles`, sender: s })}>
              <Icon name="upload" size={18} />
              <span>
                <b>All of them</b>
                <small>{ask.targets.map((t) => t.name).join(', ')}</small>
              </span>
            </button>
          )}
        </div>
        {ask.senders.length > 1 && (
          <div class="kindle-from">
            <small>Send from</small>
            <div class="chips">
              {ask.senders.map((x, i) => (
                <button class={'pill small' + (i === sender ? ' active' : '')} onClick={() => setSender(i)}>
                  {x.email}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
