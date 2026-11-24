import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { EventPage } from "@/features/storefront/screens/EventPage";
import { listedShow } from "@/features/storefront/lib/content";
import { currentCustomer } from "@/features/storefront/lib/session";
import { keystoneContext } from "@/features/keystone/context";
import { connectedAvailability } from "@/features/keystone/mutations/door";
import { publicHostPolicy } from "@/features/keystone/lib/sibling-http";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const show = await listedShow((await params).id).catch(() => null);
  return { title: show?.title || "Show" };
}

export default async function Page({ params }: Props) {
  const show = await listedShow((await params).id);
  if (!show) notFound();
  const me = await currentCustomer();
  // W2.2: a night sold by a connected Openfront shows that seller's live all-in prices, read on this request.
  const seller = show.issuer === "own" ? null : await connectedAvailability(null, { eventId: show.id }, keystoneContext.sudo(), publicHostPolicy).catch(() => null);
  return <EventPage show={show} buyer={me ? { name: me.name, email: me.email } : null} seller={seller as any} />;
}
