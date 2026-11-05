import { useState } from "react";
import { ExternalLink } from "lucide-react";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/**
 * Product logos from Simple Icons (CC0, simpleicons.org), drawn in each product's brand colour.
 * The trademarks belong to Google; they only mark links that open Google's own apps.
 */
const LOGOS = {
  maps: {
    name: "Google Maps",
    hex: "#4285F4",
    d: "M19.527 4.799c1.212 2.608.937 5.678-.405 8.173-1.101 2.047-2.744 3.74-4.098 5.614-.619.858-1.244 1.75-1.669 2.727-.141.325-.263.658-.383.992-.121.333-.224.673-.34 1.008-.109.314-.236.684-.627.687h-.007c-.466-.001-.579-.53-.695-.887-.284-.874-.581-1.713-1.019-2.525-.51-.944-1.145-1.817-1.79-2.671L19.527 4.799zM8.545 7.705l-3.959 4.707c.724 1.54 1.821 2.863 2.871 4.18.247.31.494.622.737.936l4.984-5.925-.029.01c-1.741.601-3.691-.291-4.392-1.987a3.377 3.377 0 0 1-.209-.716c-.063-.437-.077-.761-.004-1.198l.001-.007zM5.492 3.149l-.003.004c-1.947 2.466-2.281 5.88-1.117 8.77l4.785-5.689-.058-.05-3.607-3.035zM14.661.436l-3.838 4.563a.295.295 0 0 1 .027-.01c1.6-.551 3.403.15 4.22 1.626.176.319.323.683.377 1.045.068.446.085.773.012 1.22l-.003.016 3.836-4.561A8.382 8.382 0 0 0 14.67.439l-.009-.003zM9.466 5.868L14.162.285l-.047-.012A8.31 8.31 0 0 0 11.986 0a8.439 8.439 0 0 0-6.169 2.766l-.016.018 3.665 3.084z",
  },
  streetView: {
    name: "Street View",
    hex: "#FEC111",
    d: "M12.571 5.714a5.714 5.714 0 1 1 11.43 0 5.714 5.714 0 0 1-11.43 0zm2.264 5.165l-3.502 3.502c2.015-1.488 4.48-2.31 6.953-2.31 1.155 0 2.307.182 3.428.53v-1.709a6.176 6.176 0 0 1-3.428 1.037 6.177 6.177 0 0 1-3.45-1.05zm6.88 11.407V13.12a11.074 11.074 0 0 0-3.43-.55 11.25 11.25 0 0 0-6.731 2.265c-.425.34-.697.863-.697 1.45V24H20a1.72 1.72 0 0 0 1.714-1.714zM13.12 9.165L.001 22.285V4a1.72 1.72 0 0 1 1.713-1.714h11.394a6.176 6.176 0 0 0-1.037 3.428c0 1.276.388 2.463 1.05 3.45zm-5.246-1.95a2.7 2.7 0 0 0-.077-.644h-2.94v1.142h1.69c.001.303-.228.755-.625 1.025-.258.176-.606.298-1.066.298-.818 0-1.512-.552-1.76-1.295a1.887 1.887 0 0 1 0-1.196c.248-.743.942-1.295 1.76-1.295.6 0 .987.268 1.19.458l.913-.889A3.018 3.018 0 0 0 4.857 4a3.143 3.143 0 1 0 0 6.287c.848 0 1.563-.279 2.083-.759.593-.547.935-1.356.935-2.313zm2.482 9.07c0-.511.17-.995.471-1.399L1.714 24h8.643v-7.714z",
  },
  earth: {
    name: "Google Earth",
    hex: "#4285F4",
    d: "M12 0c-1.326 0-2.597.22-3.787.613 4.94-1.243 8.575 1.72 11.096 5.606 1.725 2.695 2.813 2.83 4.207 2.412A11.956 11.956 0 0012 0zM7.658 2.156c-1.644.019-3.295.775-4.931 2.207A11.967 11.967 0 000 12c.184-2.823 2.163-5.128 4.87-5.07 2.104.044 4.648 1.518 7.13 5.289 4.87 7.468 10.917 5.483 11.863 1.51.081-.566.137-1.14.137-1.729 0-.176-.02-.347-.027-.521-1.645 1.725-4.899 2.35-8.264-2.97-2.59-4.363-5.31-6.383-8.05-6.353zM3.33 13.236c-1.675.13-2.657 1.804-2.242 3.756A11.955 11.955 0 0012 24c4.215 0 7.898-2.149 10.037-5.412v-.043c-2.836 3.49-8.946 4.255-13.855-2.182-1.814-2.386-3.544-3.228-4.852-3.127Z",
  },
} as const;

type Product = keyof typeof LOGOS;

function Logo({ product, className = "size-5" }: { product: Product; className?: string }) {
  const logo = LOGOS[product];
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={`shrink-0 ${className}`}>
      <path d={logo.d} fill={logo.hex} />
    </svg>
  );
}

export interface GoogleLinks {
  maps: string;
  streetView: string;
  earth: string;
}

/** Buttons that open the site in Google's own apps, each with its product logo. */
export function GoogleButtons({ links }: { links: GoogleLinks }) {
  return (
    <ul aria-label="Open the site in Google" className="flex flex-wrap gap-2">
      {(
        [
          ["maps", `Open in ${LOGOS.maps.name}`, links.maps],
          ["streetView", `Open in ${LOGOS.streetView.name}`, links.streetView],
          ["earth", `Open in ${LOGOS.earth.name}`, links.earth],
        ] as const
      ).map(([product, label, href]) => (
        <li key={product}>
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className={`inline-flex h-11 items-center gap-2 border border-border bg-bg px-3 text-sm font-semibold text-ink hover:border-ink ${focusRing}`}
          >
            <Logo product={product} />
            {label}
            <ExternalLink aria-hidden className="size-4 text-muted" strokeWidth={1.5} />
          </a>
        </li>
      ))}
    </ul>
  );
}

/** The browser key for the free Maps Embed API (referrer-restricted; never the server key). */
export const EMBED_KEY = ((import.meta.env.VITE_GOOGLE_MAPS_EMBED_KEY as string | undefined) ?? "").trim();

const EMBED = "https://www.google.com/maps/embed/v1";

export function embedUrls(key: string, at: { lat: number; lng: number }, street?: { panoId?: string; heading?: number }) {
  const ll = `${at.lat},${at.lng}`;
  const map = `${EMBED}/place?${new URLSearchParams({ key, q: ll, center: ll, zoom: "19", maptype: "satellite" })}`;
  const sv = new URLSearchParams({ key, pitch: "0", fov: "90" });
  if (street?.panoId) sv.set("pano", street.panoId);
  else sv.set("location", ll);
  if (street?.heading !== undefined) sv.set("heading", String(Math.round(street.heading)));
  return { map, streetView: `${EMBED}/streetview?${sv}` };
}

/**
 * The site as a live canvas: Google's satellite map with the address pinned, or Street View to
 * walk the street. Google Earth cannot be embedded, so it stays a button.
 */
export function GoogleCanvas(props: {
  embedKey: string;
  at: { lat: number; lng: number };
  street?: { panoId?: string; heading?: number };
  links?: GoogleLinks;
  address: string;
}) {
  const [view, setView] = useState<"map" | "streetView">("map");
  const urls = embedUrls(props.embedKey, props.at, props.street);
  const tabs = [
    ["map", "Satellite map", "maps"],
    ["streetView", "Street View", "streetView"],
  ] as const;
  return (
    <figure aria-label="Live map of the site" className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Map view" className="inline-flex border border-ink">
          {tabs.map(([id, label, product]) => (
            <button
              key={id}
              type="button"
              aria-pressed={view === id}
              onClick={() => setView(id)}
              className={`inline-flex h-11 items-center gap-2 px-4 text-sm font-semibold ${view === id ? "bg-ink text-bg" : "bg-bg text-ink hover:bg-surface"} ${focusRing}`}
            >
              <Logo product={product} className="size-4" />
              {label}
            </button>
          ))}
        </div>
        {props.links && <GoogleButtons links={props.links} />}
      </div>
      <div className="relative aspect-[4/3] w-full overflow-hidden border border-ink bg-surface md:aspect-[16/9]">
        <iframe
          key={view}
          title={view === "map" ? `Satellite map of ${props.address}` : `Street View at ${props.address}`}
          src={view === "map" ? urls.map : urls.streetView}
          className="absolute inset-0 size-full border-0"
          loading="lazy"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
      <figcaption className="text-xs text-muted">
        {view === "map" ? "Drag to pan, scroll or pinch to zoom." : "Drag to look around; click the street to move along it."} Map data and imagery from Google.
      </figcaption>
    </figure>
  );
}
