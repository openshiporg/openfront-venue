import { keystoneContext } from '@/features/keystone/context';

export type Show = {
  id: string; title: string; status: string; showAt: string; doorsAt: string; ageRestriction: string; description: string;
  photo: string | null;
  room: { id: string; name: string; city: string; address: string; timezone: string } | null;
  artists: { name: string; genre: string; billing: string }[];
  fromCents: number | null; currencyCode: string;
};
export type PublicRoom = { id: string; name: string; city: string; address: string; capacity: number; photo: string | null; shows: number };

const LISTED = ['announced', 'presale', 'on_sale', 'sold_out', 'postponed'];
/** A show whose start time has passed is no longer listed or sold, whatever its status. */
const upcoming = () => ({ OR: [{ showAt: { gt: new Date().toISOString() } }, { showAt: { equals: null } }] });
// Photos are uploaded by staff on the event and the venue (an event may instead carry an image link); their URLs are signed by the image field, so they are read through the list API.
const QUERY = `id title status showAt doorsAt ageRestriction description image photo { url }
  room { id name city address timezone capacity photo { url } }
  eventArtist_event(orderBy: [{ position: asc }]) { billing artist { name genreTags } }
  priceLevel_event(where: { status: { equals: "active" } }) { priceCents currencyCode priceLevelPhase_priceLevel { priceCents quantity sold startsAt sort } }`;

/** The price a buyer pays for a level right now: the first started phase with tickets left, else the level price. */
const currentPrice = (l: any) => {
  const phase = [...(l.priceLevelPhase_priceLevel || [])].filter((p: any) => new Date(p.startsAt) <= new Date()).sort((a: any, b: any) => a.sort - b.sort).find((p: any) => p.sold < p.quantity);
  return phase?.priceCents ?? l.priceCents;
};
const toShow = (r: any): Show => {
  const prices = (r.priceLevel_event || []).map(currentPrice).filter((n: any) => Number.isFinite(n));
  return {
    id: r.id, title: r.title, status: r.status, showAt: r.showAt, doorsAt: r.doorsAt, ageRestriction: r.ageRestriction, description: r.description || '',
    photo: r.photo?.url || r.image || null,
    room: r.room ? { id: r.room.id, name: r.room.name, city: r.room.city || '', address: r.room.address || '', timezone: r.room.timezone || '' } : null,
    artists: (r.eventArtist_event || []).filter((a: any) => a.artist?.name).map((a: any) => ({ name: a.artist.name, genre: a.artist.genreTags || '', billing: a.billing || '' })),
    fromCents: prices.length ? Math.min(...prices) : null, currencyCode: r.priceLevel_event?.[0]?.currencyCode || 'USD',
  };
};

/** Every listed show, soonest first, and the rooms they are in. Server only, fixed fields. */
export async function listedShows(): Promise<{ shows: Show[]; rooms: PublicRoom[] }> {
  try {
    const rows = (await keystoneContext.sudo().query.Event.findMany({ where: { status: { in: LISTED }, ...upcoming() }, orderBy: [{ showAt: 'asc' }], take: 100, query: QUERY })) as readonly any[];
    const rooms = new Map<string, PublicRoom>();
    for (const r of rows) {
      if (!r.room) continue;
      const v = rooms.get(r.room.id);
      if (v) v.shows += 1;
      else rooms.set(r.room.id, { id: r.room.id, name: r.room.name, city: r.room.city || '', address: r.room.address || '', capacity: r.room.capacity || 0, photo: r.room.photo?.url || null, shows: 1 });
    }
    return { shows: rows.map(toShow), rooms: [...rooms.values()].sort((a, b) => b.shows - a.shows) };
  } catch (error) {
    console.error('Storefront shows failed:', error instanceof Error ? error.message : 'unknown');
    return { shows: [], rooms: [] };
  }
}

export async function listedShow(id: string): Promise<Show | null> {
  const rows = (await keystoneContext.sudo().query.Event.findMany({ where: { id: { equals: id }, status: { in: LISTED } }, take: 1, query: QUERY })) as readonly any[];
  return rows[0] ? toShow(rows[0]) : null;
}

// Support acts already named in the title ("Velvet Harbor + Saint Juno") are not repeated.
export const billLine = (s: Show) => { const t = s.title.toLowerCase(); const support = s.artists.slice(1).map((a) => a.name).filter((n) => !t.includes(n.toLowerCase())); return support.length ? `With ${support.join(', ')}` : ''; };
export const genreOf = (s: Show) => s.artists[0]?.genre || '';

/** Room names for the request form. Server only, fixed fields. */
export async function roomChoices(): Promise<{ id: string; name: string }[]> {
  try {
    const rows = (await keystoneContext.sudo().query.Room.findMany({ orderBy: [{ name: 'asc' }], take: 50, query: 'id name' })) as readonly any[];
    return rows.map((r) => ({ id: r.id, name: r.name }));
  } catch (error) {
    console.error('Storefront rooms failed:', error instanceof Error ? error.message : 'unknown');
    return [];
  }
}
