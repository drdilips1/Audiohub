// My Cards: everything you've saved, newest first.
import { useState } from 'preact/hooks';
import { useStore } from '../lib/store.js';
import { open, go } from '../lib/nav.js';
import { CardImage } from '../components/CardImage.jsx';
import { Chip } from '../components/ui.jsx';

export function MyCards() {
  const cards = useStore('cards');
  const [filter, setFilter] = useState('all');
  const list = filter === 'all' ? cards : cards.filter((c) => c.source === filter);
  return (
    <div class="screen mycards">
      <header class="tab-head"><h1>My Cards</h1><p>{cards.length ? `${cards.length} saved on this phone` : 'Cards you save appear here.'}</p></header>
      {cards.length > 0 && (
        <div class="chips-row">
          <Chip small on={filter === 'all'} onClick={() => setFilter('all')}>All</Chip>
          <Chip small on={filter === 'ai'} onClick={() => setFilter('ai')}>Made by AI</Chip>
          <Chip small on={filter === 'offline'} onClick={() => setFilter('offline')}>Built-in designs</Chip>
        </div>
      )}
      <div class="grid">
        {list.map((c) => <button class="grid-card" onClick={() => open('editor', { spec: c })}><CardImage spec={c} scale={0.24} lazy /></button>)}
      </div>
      {!cards.length && (
        <div class="empty-state">
          <p>Make your first card in under a minute.</p>
          <button class="btn primary" onClick={() => go('home')}>Create a card</button>
        </div>
      )}
    </div>
  );
}
