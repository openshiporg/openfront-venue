import type { Show } from '../lib/content';
import { billLine, genreOf } from '../lib/content';
import { day, clock, ages } from '../lib/format';
import { Photo } from '../components/Photo';
import { EventBuy } from './EventBuy';
import { usd } from '../lib/format';

type Seller = { live: boolean; levels: { name: string; allInCents: number; soldOut: boolean }[]; soldOut: boolean | null; message?: string } | null;

export function EventPage({ show: s, buyer, seller }: { show: Show; buyer?: { name: string; email: string } | null; seller?: Seller }) {
  const tz = s.room?.timezone;
  return (
    <main>
      <div className="grid gap-6 md:grid-cols-[2fr_3fr] md:items-end md:gap-10">
        <Photo src={s.photo} alt={s.title} priority className="aspect-[3/2]" />
        <header>
          <h1 className="text-balance text-3xl font-semibold leading-tight tracking-tight md:text-5xl">{s.title}</h1>
          {billLine(s) ? <p className="mt-2 text-lg">{billLine(s)}</p> : null}
          <dl className="mt-5 grid grid-cols-[5.5rem_1fr] gap-y-1.5 text-[15px]">
            <dt className="text-black/60">When</dt><dd>{day(s.showAt, tz)} · show {clock(s.showAt, tz)} · doors {clock(s.doorsAt, tz)}</dd>
            {s.room ? <><dt className="text-black/60">Where</dt><dd>{s.room.name}<span className="text-black/70">{[s.room.address, s.room.city].filter(Boolean).length ? ` · ${[s.room.address, s.room.city].filter(Boolean).join(', ')}` : ''}</span></dd></> : null}
            <dt className="text-black/60">Ages</dt><dd>{ages(s.ageRestriction)}</dd>
            {genreOf(s) ? <><dt className="text-black/60">Music</dt><dd>{genreOf(s)}</dd></> : null}
          </dl>
          {s.description ? <p className="mt-4 max-w-prose">{s.description}</p> : null}
        </header>
      </div>
      {s.issuer === 'own' ? <EventBuy eventId={s.id} status={s.status} buyer={buyer} /> : <section className="mt-8 max-w-xl rounded-lg border border-black/15 p-5">
        <h2 className="text-lg font-semibold">Tickets from {s.sellerName || 'the promoter'}</h2>
        {seller?.live && seller.levels.length ? <ul className="mt-3 divide-y divide-black/10">{seller.levels.map(l => <li key={l.name} className="flex justify-between py-2 text-[15px]"><span>{l.name}</span><span>{l.soldOut ? 'Sold out' : `${usd(l.allInCents)} all in`}</span></li>)}</ul> : <p className="mt-2 text-[15px] text-black/70">{seller?.message || 'Prices and availability are on the seller’s page.'}</p>}
        {s.sellerUrl && !seller?.soldOut ? <a href={s.sellerUrl} className="mt-4 inline-flex h-11 items-center rounded-md bg-black px-5 font-medium text-white">Buy on {s.sellerName || 'the seller’s site'}</a> : seller?.soldOut ? <p className="mt-3 font-medium">Sold out</p> : null}
      </section>}
    </main>
  );
}
