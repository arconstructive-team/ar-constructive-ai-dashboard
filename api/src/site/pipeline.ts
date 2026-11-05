/**
 * The site report pipeline. The address lookup runs first; every other step then runs on its
 * own, in parallel. A step that fails is recorded as failed with the reason, and the rest of the
 * report still comes back. The pipeline is deterministic: no model, only public sources.
 */
import { clean, censusGeocodeUrl, googleGeocodeUrl, parseCensusGeocode, parseGoogleGeocode } from "./geocode";
import {
  CALFIRE_CHECK,
  CEC_CHECK,
  CGS_CHECK,
  FEMA_CHECK,
  climateZoneUrl,
  elevationUrl,
  googleElevationUrl,
  fireZoneUrl,
  floodUrl,
  parseClimateZone,
  parseElevation,
  parseGoogleElevation,
  parseFire,
  parseFlood,
  parseSeismic,
  responsibilityUrl,
  seismicUrls,
} from "./hazards";
import { SourceError, getJson, sourceRef, type Fetch, type HttpOptions } from "./http";
import { parseSection, sectionLines, sectionUrl } from "./terrain";
import { STATIC_MAP, mapLinks, parseStreetViewMetadata, satelliteImages, streetViewMetadataUrl } from "./imagery";
import {
  CITY_ZONING_MAPS,
  COUNTY_PROPERTY_MAPS,
  countyZoningFor,
  parseCountyZoning,
  parseJurisdiction,
  placeUrl,
  zoningUrl,
} from "./jurisdiction";
import { parcelAddressUrl, parcelPointUrl, parcelSourceFor, parseParcel } from "./parcel";
import { parseSolar, solarUrl } from "./solar";
import { stepFacts } from "./chat";
import { STEP_NAMES } from "./types";
import type {
  ClimateZone,
  Elevation,
  FireZone,
  FloodZone,
  Geocode,
  Jurisdiction,
  Parcel,
  Satellite,
  SeismicZones,
  SiteReport,
  SiteSteps,
  SolarRoof,
  SourceRef,
  Step,
  StreetView,
  Zoning,
} from "./types";

export interface PipelineOptions {
  /** The Google Maps Platform key (server only). Without it the Google steps fail and the Census geocoder is used. */
  apiKey?: string;
  fetch?: Fetch;
  now?: () => Date;
  timeoutMs?: number;
  /** Wait before a retry (tests set 0). */
  retryDelayMs?: number;
}

export const NO_KEY = "The Google Maps key is not set on the server (GOOGLE_MAPS_API_KEY).";
const NEEDS_LOCATION = "This step needs the address location, and the address lookup failed.";
/** Beyond this, Google's "closest building" may be a neighbor's. */
const SOLAR_FAR_FEET = 150;

/** Per-source overrides of the request timeout and retries (see HttpOptions). */
type GetOptions = Pick<HttpOptions, "timeoutMs" | "retries">;
type Get = (name: string, url: string, opts?: GetOptions) => Promise<unknown | null>;

/**
 * The USGS elevation service is often slow (15 s and more) and sometimes answers HTTP 500 for a
 * moment, so it gets a longer timeout and one more try than the other sources.
 */
const ELEVATION_HTTP: GetOptions = { timeoutMs: 25_000, retries: 1 };

/** A source message without its full stop, to quote inside another sentence. */
const bare = (message: string) => message.replace(/\.$/, "");
type Cite = (name: string, url: string) => void;
type Outcome<T> = Omit<Step<T>, "sources">;

export async function buildSiteReport(address: string, options: PipelineOptions = {}): Promise<SiteReport> {
  const now = options.now ?? (() => new Date());
  const doFetch: Fetch = options.fetch ?? ((input, init) => fetch(input, init));
  const http: HttpOptions = { fetch: doFetch, timeoutMs: options.timeoutMs, retryDelayMs: options.retryDelayMs };
  const key = options.apiKey?.trim() || undefined;

  async function step<T>(work: (get: Get, cite: Cite) => Promise<Outcome<T>>, checkUrl?: string): Promise<Step<T>> {
    const sources: SourceRef[] = [];
    const cite: Cite = (name, url) => void sources.push(sourceRef(name, url, now));
    const get: Get = (name, url, opts) => {
      cite(name, url);
      // A timeout set by the caller (tests) wins over a source's own.
      return getJson(url, { ...http, ...opts, timeoutMs: options.timeoutMs ?? opts?.timeoutMs });
    };
    try {
      const out = await work(get, cite);
      return clean({ ...out, sources, checkUrl: out.checkUrl ?? checkUrl });
    } catch (err) {
      const error = err instanceof SourceError ? err.message : "The step stopped with an unexpected error.";
      return clean({ status: "failed" as const, sources, error, checkUrl });
    }
  }

  const failed = <T>(error: string, checkUrl?: string): Step<T> => clean({ status: "failed" as const, sources: [], error, checkUrl });

  const geocode = await step<Geocode>(async (get) => {
    let note: string | undefined;
    if (key) {
      try {
        return { status: "ok", data: parseGoogleGeocode(await get("Google Geocoding API", googleGeocodeUrl(address, key))) };
      } catch (err) {
        note = `Google Geocoding failed (${err instanceof SourceError ? err.message : "unexpected error"}); the US Census geocoder was used.`;
      }
    } else {
      note = "No Google key on the server; the US Census geocoder was used.";
    }
    return { status: "ok", data: parseCensusGeocode(await get("US Census Geocoder", censusGeocodeUrl(address)), address), note };
  });

  const geo = geocode.data;
  const generatedAt = now().toISOString();
  if (!geo) {
    const steps = { geocode } as SiteSteps;
    for (const name of ["streetView", "satellite", "solar", "parcel", "jurisdiction", "zoning", "flood", "fire", "seismic", "elevation", "climateZone"] as const) {
      (steps as unknown as Record<string, Step<unknown>>)[name] = failed(NEEDS_LOCATION);
    }
    return { version: 1, address, generatedAt, steps };
  }
  const at = { lat: geo.lat, lng: geo.lng };

  const streetView = key
    ? step<StreetView>(async (get) => {
        const view = parseStreetViewMetadata(await get("Google Street View Static API (metadata)", streetViewMetadataUrl(at, key)), at, key);
        return view ? { status: "ok", data: view } : { status: "unknown", note: "Google has no Street View near this address." };
      })
    : Promise.resolve(failed<StreetView>(NO_KEY));

  const satellite = key
    ? step<Satellite>(async (_get, cite) => {
        const data = satelliteImages(at, key);
        cite("Google Maps Static API (satellite)", `${STATIC_MAP}?center=${at.lat.toFixed(6)},${at.lng.toFixed(6)}&maptype=satellite`);
        return { status: "ok", data };
      })
    : Promise.resolve(failed<Satellite>(NO_KEY));

  const solar = key
    ? step<SolarRoof>(async (get) => {
        const roof = parseSolar(await get("Google Solar API (buildingInsights)", solarUrl(at, key)), at);
        if (!roof) return { status: "unknown", note: "Google has no roof data for this building." };
        const note =
          roof.distanceFeet > SOLAR_FAR_FEET
            ? `Google's closest building is ${roof.distanceFeet} ft from the address point. Check that it is the right building.`
            : undefined;
        return { status: "ok", data: roof, note };
      })
    : Promise.resolve(failed<SolarRoof>(NO_KEY));

  const parcelSource = parcelSourceFor(geo.county);
  const parcel = parcelSource
    ? step<Parcel>(async (get) => {
        const byPoint = parseParcel(await get(parcelSource.name, parcelPointUrl(parcelSource, at)), parcelSource, "point");
        if (byPoint) return { status: "ok", data: byPoint };
        const addressUrl = parcelAddressUrl(parcelSource, geo);
        const byAddress = addressUrl ? parseParcel(await get(parcelSource.name, addressUrl), parcelSource, "address") : null;
        if (byAddress) {
          return { status: "ok", data: byAddress, note: "The address point is outside the lot, so the parcel was matched by its address." };
        }
        return { status: "unknown", note: "The county parcel map has no parcel at this point or address." };
      }, parcelSource.viewerUrl)
    : Promise.resolve<Step<Parcel>>({
        status: "unknown",
        sources: [],
        note: `Parcel lookup is not set up for ${geo.county ?? "this county"} yet.`,
      });

  const jurisdiction = step<Jurisdiction>(async (get) => ({
    status: "ok",
    data: parseJurisdiction(await get("US Census TIGERweb incorporated places", placeUrl(at)), geo.county),
  }));

  const zoning = jurisdiction.then((j): Promise<Step<Zoning>> => {
    if (!j.data) return Promise.resolve(failed<Zoning>("This step needs the jurisdiction, and that step failed."));
    const place = j.data;
    const countySource = place.kind === "unincorporated" ? countyZoningFor(geo.county) : undefined;
    if (countySource) {
      return step<Zoning>(async (get) => {
        const z = parseCountyZoning(await get(countySource.name, zoningUrl(countySource, at)), countySource);
        return z
          ? { status: "ok", data: z }
          : { status: "unknown", data: { mapUrl: countySource.mapUrl }, note: "The county zoning map has no district at this point." };
      }, countySource.mapUrl);
    }
    const mapUrl = CITY_ZONING_MAPS[place.name] ?? (geo.county ? COUNTY_PROPERTY_MAPS[geo.county] : undefined);
    const outcome: Step<Zoning> = {
      status: "unknown",
      sources: [],
      note: `${place.name} has no public zoning map service we can read. Check the zoning district on its map.`,
    };
    if (mapUrl) {
      outcome.data = { mapUrl };
      outcome.checkUrl = mapUrl;
    }
    return Promise.resolve(outcome);
  });

  const flood = step<FloodZone>(async (get) => {
    const z = parseFlood(await get("FEMA National Flood Hazard Layer", floodUrl(at)));
    return z ? { status: "ok", data: z } : { status: "unknown", note: "No FEMA flood map covers this point." };
  }, `${FEMA_CHECK}?${new URLSearchParams({ AddressQuery: geo.formattedAddress || address })}`);

  const fire = step<FireZone>(async (get) => {
    const [zone, sra] = await Promise.all([
      get("CAL FIRE Fire Hazard Severity Zones (SRA and LRA)", fireZoneUrl(at)),
      get("CAL FIRE State Responsibility Areas", responsibilityUrl(at)),
    ]);
    return { status: "ok", data: parseFire(zone, sra) };
  }, CALFIRE_CHECK);

  const seismic = step<SeismicZones>(async (get) => {
    const urls = seismicUrls(at);
    const [liquefaction, landslide, faultZone] = await Promise.all([
      get("CGS Seismic Hazard Zones: liquefaction", urls.liquefaction),
      get("CGS Seismic Hazard Zones: earthquake-induced landslides", urls.landslide),
      get("CGS Alquist-Priolo Earthquake Fault Zones", urls.faultZone),
    ]);
    return {
      status: "ok",
      data: parseSeismic({ liquefaction, landslide, faultZone }),
      note: "Areas CGS has not yet evaluated also show as outside a zone. Check the CGS map for this lot.",
    };
  }, CGS_CHECK);

  // USGS first (the official source); Google Elevation only when USGS fails and the key is set.
  const elevationPoint = async (get: Get): Promise<Outcome<Elevation>> => {
    let usgsError: SourceError;
    try {
      return { status: "ok", data: parseElevation(await get("USGS Elevation Point Query Service", elevationUrl(at), ELEVATION_HTTP)) };
    } catch (err) {
      if (!(err instanceof SourceError) || !key) throw err;
      usgsError = err;
    }
    try {
      return {
        status: "ok",
        data: parseGoogleElevation(await get("Google Elevation API", googleElevationUrl(at, key))),
        note: `USGS failed (${bare(usgsError.message)}); the Google Elevation API was used.`,
      };
    } catch (err) {
      if (!(err instanceof SourceError)) throw err;
      throw new SourceError(`USGS failed (${bare(usgsError.message)}), and so did Google (${bare(err.message)}).`);
    }
  };

  // The terrain sections cut through the parcel outline, so they wait for the parcel step.
  const elevation = step<Elevation>(async (get) => {
    const [point, lot] = await Promise.all([elevationPoint(get), parcel]);
    if (!key || !point.data) return point;
    const lines = sectionLines(at, lot.data?.outline);
    const read = await Promise.allSettled(lines.map(async (line) => parseSection(await get("Google Elevation API (terrain section)", sectionUrl(line, key)), line)));
    const sections = read.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    const lost = read.find((r): r is PromiseRejectedResult => r.status === "rejected");
    const lostNote = lost
      ? `The terrain sections could not be read (${lost.reason instanceof SourceError ? bare(lost.reason.message) : "unexpected error"}).`
      : undefined;
    const note = [point.note, lostNote].filter(Boolean).join(" ") || undefined;
    return { ...point, data: sections.length > 0 ? { ...point.data, sections } : point.data, note };
  });

  const climateZone = step<ClimateZone>(async (get) => {
    const z = parseClimateZone(await get("California Energy Commission building climate zones", climateZoneUrl(at)));
    return z ? { status: "ok", data: z } : { status: "unknown", note: "This point is outside the California climate zone map." };
  }, CEC_CHECK);

  const [sv, sat, sol, par, jur, zon, fl, fi, se, el, cz] = await Promise.all([
    streetView, satellite, solar, parcel, jurisdiction, zoning, flood, fire, seismic, elevation, climateZone,
  ]);
  const firstHeading = sv.data?.images[0]?.heading;
  const links = mapLinks(at, geo.placeId, sv.data ? { panoId: sv.data.panoId, heading: firstHeading } : undefined);
  const report: SiteReport = {
    version: 1,
    address,
    generatedAt,
    links,
    steps: {
      geocode,
      streetView: sv,
      satellite: sat,
      solar: sol,
      parcel: par,
      jurisdiction: jur,
      zoning: zon,
      flood: fl,
      fire: fi,
      seismic: se,
      elevation: el,
      climateZone: cz,
    },
  };
  for (const name of STEP_NAMES) {
    const summary = stepFacts(report, name);
    if (summary) (report.steps[name] as Step<unknown>).summary = summary;
  }
  return report;
}
