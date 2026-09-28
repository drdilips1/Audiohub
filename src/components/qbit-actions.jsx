import { toast } from './common.jsx';
import * as qb from '../sources/qbit.js';
/** Clear the sent list, and remove broken ("files missing") torrents from qBittorrent. */
export function QbitListActions({ list, busy, run, refresh, setList }) {
  const broken = (list || []).filter(qb.isBroken);
  return (
    <>
      {broken.length > 0 && (
        <button
          class="pill small ghost"
          disabled={!!busy}
          onClick={() => {
            if (!confirm(`Remove ${broken.length} broken download${broken.length === 1 ? '' : 's'} (files missing / error) from qBittorrent? Files already downloaded are kept.`)) return;
            run('broken', async () => {
              const m = await qb.removeBroken(broken);
              refresh();
              return m;
            });
          }}
        >
          {busy === 'broken' ? <span class="spinner small" /> : `Remove ${broken.length} broken`}
        </button>
      )}
      {list?.length > 0 && (
        <button
          class="pill small ghost"
          disabled={!!busy}
          onClick={() => {
            qb.clearList((list || []).map((t) => t.hash));
            setList([]);
            toast('List cleared');
          }}
        >
          Clear list
        </button>
      )}
    </>
  );
}
