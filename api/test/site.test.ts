import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { siteReportFrom } from "../src/chat/firestore";
import { MemoryChatStore } from "../src/chat/store";
import { runTool, TOOL_SPECS } from "../src/chat/tools";
import { createApp } from "../src/server";
import { READ_SITE_REPORT_TOOL, runReadSiteReport, siteReportText, siteSummary } from "../src/site/chat";
import { parseCensusGeocode, parseGoogleGeocode } from "../src/site/geocode";
import { parseClimateZone, parseElevation, parseFire, parseFlood, parseGoogleElevation, parseSeismic } from "../src/site/hazards";
import { bearing, getJson, SourceError, type Fetch } from "../src/site/http";
import { googleImageUrl, imagePath, mapLinks, parseStreetViewMetadata, satelliteImages } from "../src/site/imagery";
import { COUNTY_ZONING, parseCountyZoning, parseJurisdiction } from "../src/site/jurisdiction";
import { PARCEL_SOURCES, parcelAddressUrl, parcelSourceFor, parseParcel, streetName } from "../src/site/parcel";
import { NO_KEY, buildSiteReport } from "../src/site/pipeline";
import { parseSolar } from "../src/site/solar";
import { STEP_NAMES, type SiteReport } from "../src/site/types";

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/site-el-rio/${name}.json`, import.meta.url), "utf8"));

const ADDRESS = "428 El Rio Rd, Danville, CA 94526";
const KEY = "test-google-key";
const SITE = { lat: 37.83232, lng: -122.00047 };
const NOW = () => new Date("2026-11-05T18:00:00.000Z");
const contraCosta = PARCEL_SOURCES[0]!;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Paths of values Firestore would refuse: undefined, or an array inside an array. */
function firestoreProblems(value: unknown, path = "report", inArray = false): string[] {
  if (value === undefined) return [path];
  if (Array.isArray(value)) {
    if (inArray) return [`${path} (nested array)`];
    return value.flatMap((v, i) => firestoreProblems(v, `${path}[${i}]`, true));
  }
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => firestoreProblems(v, `${path}.${k}`, false));
  }
  return [];
}

interface FakeOptions {
  /** URL parts whose request fails, with the HTTP status (0: network error). */
  fail?: Record<string, number>;
  /** The parcel point query finds the lot (true with Google's rooftop point). */
  parcelPointHit?: boolean;
}

/** Replays the recorded answers by URL; records every URL it was asked for. */
function fakeFetch(options: FakeOptions = {}) {
  const urls: string[] = [];
  const routes: [string, () => unknown][] = [
    ["geocoding.geo.census.gov", () => fixture("census-geocode")],
    ["maps/api/geocode", () => fixture("google-geocode")],
    ["streetview/metadata", () => fixture("streetview-metadata")],
    ["solar.googleapis.com", () => fixture("solar-building-insights")],
    ["Assessment_Parcels_ArcPro", () => fixture("parcel-address")],
    ["tigerweb.geo.census.gov", () => fixture("tiger-place")],
    ["ContraCostaCountyPlanningLayers", () => fixture("county-zoning-empty")],
    ["hazards.fema.gov", () => fixture("fema-flood")],
    ["fhsz24_5", () => fixture("calfire-fhsz-empty")],
    ["State_Responsibility_Area", () => fixture("calfire-sra")],
    ["CGS_", () => fixture("cgs-empty")],
    ["epqs.nationalmap.gov", () => fixture("epqs")],
    ["BuildingClimateZones", () => fixture("cec-climate")],
  ];
  const doFetch: Fetch = async (input) => {
    const url = String(input);
    urls.push(url);
    for (const [part, status] of Object.entries(options.fail ?? {})) {
      if (url.includes(part)) {
        if (status === 0) throw new TypeError("fetch failed");
        return json({ error: "down" }, status);
      }
    }
    if (url.includes("Assessment_Parcels_ArcPro") && url.includes("geometry=") && !options.parcelPointHit) {
      return json(fixture("parcel-point-empty"));
    }
    const route = routes.find(([part]) => url.includes(part));
    return route ? json(route[1]()) : json({ error: "no fixture" }, 404);
  };
  return { fetch: doFetch, urls };
}

describe("source parsers (recorded answers for 428 El Rio Rd)", () => {
  it("reads the Census geocoder answer with the county", () => {
    const g = parseCensusGeocode(fixture("census-geocode"));
    expect(g).toMatchObject({
      formattedAddress: "428 EL RIO RD, DANVILLE, CA, 94526",
      lat: 37.832654253044,
      lng: -122.00450165358,
      streetNumber: "428",
      street: "EL RIO RD",
      county: "Contra Costa County",
      zip: "94526",
      provider: "census",
    });
  });

  it("keeps a Census match in the city or ZIP that was asked for", () => {
    expect(parseCensusGeocode(fixture("census-geocode"), ADDRESS).zip).toBe("94526");
    // The postal city may differ from the city the architect wrote: the ZIP alone is enough.
    expect(parseCensusGeocode(fixture("census-geocode"), "428 El Rio Rd, Alamo, CA 94526").zip).toBe("94526");
    // No city or ZIP to check against: the first match stands.
    expect(parseCensusGeocode(fixture("census-geocode"), "428 El Rio Rd").zip).toBe("94526");
  });

  it("refuses a Census match in another city and ZIP", () => {
    // The live Census answer for "456 Oak Ave, San Ramon, CA 94583" (2026-11-05): one fuzzy match 400 miles away.
    const ramona = {
      result: {
        addressMatches: [
          {
            matchedAddress: "456 OAK ST, RAMONA, CA, 92065",
            coordinates: { x: -116.867034, y: 33.050653 },
            addressComponents: { zip: "92065", city: "RAMONA", state: "CA", streetName: "OAK", suffixType: "ST" },
          },
        ],
      },
    };
    expect(() => parseCensusGeocode(ramona, "456 Oak Ave, San Ramon, CA 94583")).toThrow(SourceError);
    expect(() => parseCensusGeocode(ramona, "456 Oak Ave, San Ramon, CA 94583")).toThrow(/456 OAK ST, RAMONA/);
    // A later match in the right place is taken over the first one.
    const danville = (fixture("census-geocode") as { result: { addressMatches: unknown[] } }).result.addressMatches;
    const both = { result: { addressMatches: [...ramona.result.addressMatches, ...danville] } };
    expect(parseCensusGeocode(both, ADDRESS).city).toBe("DANVILLE");
  });

  it("reads the Google geocoding answer", () => {
    const g = parseGoogleGeocode(fixture("google-geocode"));
    expect(g).toMatchObject({ lat: SITE.lat, lng: SITE.lng, accuracy: "ROOFTOP", street: "El Rio Rd", county: "Contra Costa County", provider: "google" });
    expect(g.placeId).toBe("SYNTHETIC_PLACE_ID_428_EL_RIO");
    expect(() => parseGoogleGeocode({ status: "ZERO_RESULTS", results: [] })).toThrow(SourceError);
    expect(() => parseGoogleGeocode({ status: "REQUEST_DENIED", error_message: "API not enabled" })).toThrow(/API not enabled/);
  });

  it("finds the parcel by address when the point is in the street", () => {
    expect(parseParcel(fixture("parcel-point-empty"), contraCosta, "point")).toBeNull();
    const p = parseParcel(fixture("parcel-address"), contraCosta, "address")!;
    expect(p).toMatchObject({ apn: "200-030-023", assessorAcres: 0.92, useCode: "11", situsCity: "DANVILLE", matchedBy: "address" });
    expect(p.outline).toHaveLength(5);
    // The outline area agrees with the assessor's lot area (43,680 sq ft on the roll).
    expect(p.lotAreaSqft).toBeGreaterThan(41_000);
    expect(p.lotAreaSqft).toBeLessThan(46_000);
    expect(streetName("El Rio Rd")).toBe("EL RIO");
    const byAddress = new URL(parcelAddressUrl(contraCosta, { streetNumber: "428", street: "El Rio Rd" })!);
    expect(byAddress.searchParams.get("where")).toBe("full_address_search LIKE '428 EL RIO%'");
    expect(parcelAddressUrl(contraCosta, { street: "El Rio Rd" })).toBeNull();
    expect(parcelSourceFor("Contra Costa County")).toBe(contraCosta);
    expect(parcelSourceFor("Alameda County")).toBeUndefined();
  });

  it("names the incorporated town, or the unincorporated county", () => {
    expect(parseJurisdiction(fixture("tiger-place"), "Contra Costa County")).toEqual({
      kind: "city",
      name: "Town of Danville",
      county: "Contra Costa County",
    });
    expect(parseJurisdiction({ features: [] }, "Contra Costa County").name).toBe("Unincorporated Contra Costa County");
  });

  it("reads county zoning when a district covers the point", () => {
    const src = COUNTY_ZONING[0]!;
    expect(parseCountyZoning(fixture("county-zoning-empty"), src)).toBeNull();
    // Synthetic: the layer's field names with a typical district.
    const z = parseCountyZoning({ features: [{ attributes: { ZONING: "R-20", ZONING_TEX: "Single Family Residential", OVERLAY_TE: " " } }] }, src);
    expect(z).toEqual({ district: "R-20", description: "Single Family Residential", mapUrl: src.mapUrl });
  });

  it("reads the FEMA flood zone", () => {
    expect(parseFlood(fixture("fema-flood"))).toEqual({
      zone: "X",
      subtype: "AREA OF MINIMAL FLOOD HAZARD",
      inSpecialFloodHazardArea: false,
      firmPanelId: "06013C",
    });
    expect(parseFlood({ features: [] })).toBeNull();
    expect(() => parseFlood({ error: { code: 400, message: "Invalid geometry" } })).toThrow(/Invalid geometry/);
  });

  it("reads the CAL FIRE zone and responsibility area, and when Chapter 7A applies", () => {
    expect(parseFire(fixture("calfire-fhsz-empty"), fixture("calfire-sra"))).toEqual({
      responsibility: "LRA",
      hazardClass: null,
      chapter7A: "not indicated",
    });
    // Synthetic features with the layer's field names.
    const zone = (description: string) => ({ features: [{ attributes: { FHSZ: 0, FHSZ_Description: description } }] });
    const sra = (value: string) => ({ features: [{ attributes: { SRA: value } }] });
    expect(parseFire(zone("Very High"), sra("LRA"))).toMatchObject({ hazardClass: "Very High", chapter7A: "applies" });
    expect(parseFire(zone("High"), sra("LRA"))).toMatchObject({ hazardClass: "High", chapter7A: "check" });
    expect(parseFire(zone("Moderate"), sra("SRA"))).toMatchObject({ hazardClass: "Moderate", responsibility: "SRA", chapter7A: "applies" });
  });

  it("reads the CGS zones, elevation and climate zone", () => {
    const empty = fixture("cgs-empty");
    expect(parseSeismic({ liquefaction: empty, landslide: empty, faultZone: empty })).toEqual({
      liquefaction: false,
      landslide: false,
      faultZone: false,
    });
    expect(parseSeismic({ liquefaction: { features: [{ attributes: { OBJECTID: 1 } }] }, landslide: empty, faultZone: empty }).liquefaction).toBe(true);
    expect(parseElevation(fixture("epqs"))).toEqual({ feet: 417.9 });
    expect(() => parseElevation({ value: -1000000 })).toThrow(SourceError);
    expect(parseClimateZone(fixture("cec-climate"))).toEqual({ zone: "12" });
    expect(parseClimateZone({ features: [] })).toBeNull();
  });

  it("reads the Solar API roof segments in feet", () => {
    const roof = parseSolar(fixture("solar-building-insights"), SITE)!;
    expect(roof.roofAreaSqft).toBe(3364);
    expect(roof.segments).toHaveLength(3);
    expect(roof.segments[0]).toEqual({ pitchDegrees: 22.6, azimuthDegrees: 183, areaSqft: 1295, sunshineHoursPerYear: 1680 });
    expect(roof.imageryDate).toBe("2022-06-14");
    expect(roof.distanceFeet).toBeLessThan(20);
    expect(parseSolar(null, SITE)).toBeNull();
  });

  it("aims the first Street View image at the property and signs every image path", () => {
    const view = parseStreetViewMetadata(fixture("streetview-metadata"), SITE, KEY)!;
    expect(view.panoId).toBe("SYNTHETIC_PANO_428_EL_RIO");
    expect(view.images).toHaveLength(4);
    const toSite = bearing(view.location, SITE);
    expect(view.images.map((i) => i.heading)).toEqual([0, 90, 180, 270].map((d) => (toSite + d) % 360));
    for (const img of view.images) expect(img.path).toMatch(/^\/api\/site\/image\?kind=streetview&.*sig=/);
    expect(parseStreetViewMetadata({ status: "ZERO_RESULTS" }, SITE, KEY)).toBeNull();
    expect(satelliteImages(SITE, KEY).images.map((i) => i.zoom)).toEqual([18, 20]);
  });
});

describe("signed image paths", () => {
  const path = imagePath({ kind: "streetview", pano: "P1", heading: "90", pitch: "0", fov: "90", size: "640x400" }, KEY);
  const query = () => new URL(path, "http://x").searchParams;

  it("turn into a Google URL with the server key", () => {
    const google = googleImageUrl(query(), KEY)!;
    expect(google).toContain("https://maps.googleapis.com/maps/api/streetview?");
    expect(google).toContain("pano=P1");
    expect(google).toContain(`key=${KEY}`);
    expect(path).not.toContain(KEY);
  });

  it("refuse a changed parameter, an extra parameter or another key", () => {
    const changed = query();
    changed.set("heading", "180");
    expect(googleImageUrl(changed, KEY)).toBeNull();
    const extra = query();
    extra.set("markers", "anything");
    expect(googleImageUrl(extra, KEY)).toBeNull();
    expect(googleImageUrl(query(), "another-key")).toBeNull();
  });

  it("link to Maps, Street View and Earth without a key", () => {
    const links = mapLinks(SITE, "PLACE", { panoId: "P1", heading: 90 });
    expect(links.maps).toContain("query_place_id=PLACE");
    expect(links.streetView).toContain("map_action=pano");
    expect(links.earth).toContain("earth.google.com/web/@37.832320,-122.000470");
  });
});

describe("site report pipeline", () => {
  it("builds every step with its source and date, and never stores the key", async () => {
    const fake = fakeFetch({ parcelPointHit: true });
    const report = await buildSiteReport(ADDRESS, { apiKey: KEY, fetch: fake.fetch, now: NOW });
    const s = report.steps;
    for (const name of STEP_NAMES.filter((n) => n !== "zoning")) expect(s[name].status, name).toBe("ok");
    expect(s.geocode.data?.provider).toBe("google");
    expect(s.parcel.data).toMatchObject({ apn: "200-030-023", matchedBy: "point" });
    expect(s.jurisdiction.data?.name).toBe("Town of Danville");
    expect(s.zoning).toMatchObject({ status: "unknown", checkUrl: "https://danville.ca.gov/540/Zoning-Ordinance-Map" });
    expect(s.flood.data?.zone).toBe("X");
    expect(s.fire.data).toMatchObject({ responsibility: "LRA", hazardClass: null });
    expect(s.fire.summary).toContain("not in a mapped Fire Hazard Severity Zone");
    expect(s.zoning.summary).toBe("zoning district unknown; zoning map: https://danville.ca.gov/540/Zoning-Ordinance-Map");
    expect(s.climateZone.data?.zone).toBe("12");
    expect(s.solar.data?.segments).toHaveLength(3);
    expect(s.streetView.data?.images).toHaveLength(4);
    expect(report.links?.streetView).toContain("pano=SYNTHETIC_PANO_428_EL_RIO");
    for (const name of STEP_NAMES.filter((n) => n !== "zoning")) {
      expect(s[name].sources.length, name).toBeGreaterThan(0);
      for (const src of s[name].sources) expect(src.fetchedAt).toBe("2026-11-05T18:00:00.000Z");
    }
    // The key is used for the Google requests but appears nowhere in the saved report.
    expect(fake.urls.some((u) => u.includes(`key=${KEY}`))).toBe(true);
    expect(JSON.stringify(report)).not.toContain(KEY);
    // Firestore refuses undefined values and nested arrays.
    expect(firestoreProblems(report)).toEqual([]);
  });

  it("works without a Google key: Census geocoder, Google steps marked failed", async () => {
    const report = await buildSiteReport(ADDRESS, { fetch: fakeFetch().fetch, now: NOW });
    const s = report.steps;
    expect(s.geocode).toMatchObject({ status: "ok", data: { provider: "census" } });
    expect(s.geocode.note).toContain("US Census");
    for (const name of ["streetView", "satellite", "solar"] as const) expect(s[name]).toMatchObject({ status: "failed", error: NO_KEY });
    expect(s.parcel.data).toMatchObject({ apn: "200-030-023", matchedBy: "address" });
    expect(s.parcel.sources).toHaveLength(2);
    expect(s.flood.status).toBe("ok");
    expect(s.elevation.data?.feet).toBe(417.9);
  });

  it("marks only the failing sources as failed; the rest of the report still comes back", async () => {
    const fake = fakeFetch({ fail: { "hazards.fema.gov": 500, fhsz24_5: 0, "solar.googleapis.com": 403 }, parcelPointHit: true });
    const report = await buildSiteReport(ADDRESS, { apiKey: KEY, fetch: fake.fetch, now: NOW });
    const s = report.steps;
    expect(s.flood).toMatchObject({ status: "failed", error: "The source answered with HTTP 500." });
    expect(s.flood.sources[0]?.name).toBe("FEMA National Flood Hazard Layer");
    expect(s.fire).toMatchObject({ status: "failed", error: "The source could not be reached." });
    expect(s.solar.status).toBe("failed");
    for (const name of ["geocode", "streetView", "parcel", "jurisdiction", "seismic", "elevation", "climateZone"] as const) {
      expect(s[name].status, name).toBe("ok");
    }
  });

  it("falls back to the Census geocoder when Google fails", async () => {
    const report = await buildSiteReport(ADDRESS, { apiKey: KEY, fetch: fakeFetch({ fail: { "maps/api/geocode": 500 } }).fetch, now: NOW });
    expect(report.steps.geocode).toMatchObject({ status: "ok", data: { provider: "census" } });
    expect(report.steps.geocode.note).toContain("Google Geocoding failed");
  });

  it("marks every step failed when the address cannot be found", async () => {
    const fake = fakeFetch({ fail: { "geocoding.geo.census.gov": 500 } });
    const report = await buildSiteReport("nowhere", { fetch: fake.fetch, now: NOW });
    for (const name of STEP_NAMES) expect(report.steps[name].status, name).toBe("failed");
    expect(report.steps.flood.error).toContain("address lookup failed");
  });
});

describe("site routes", () => {
  let server: Server;
  let base: string;
  const fake = fakeFetch({ parcelPointHit: true });
  const imageFetch: Fetch = async (input, init) =>
    String(input).startsWith("https://maps.googleapis.com/maps/api/streetview?")
      ? new Response(new Uint8Array([0xff, 0xd8, 0xff]), { headers: { "content-type": "image/jpeg" } })
      : fake.fetch(input, init);

  beforeAll(async () => {
    server = createApp({
      site: {
        apiKey: KEY,
        fetch: imageFetch,
        now: NOW,
        authorize: async (header) => {
          if (header !== "Bearer team-token") throw Object.assign(new Error("no"), { status: header ? 403 : 401 });
        },
      },
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const post = (body: unknown, token?: string) =>
    fetch(`${base}/api/site/report`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });

  it("asks for a signed-in team member", async () => {
    expect((await post({ address: ADDRESS })).status).toBe(401);
    expect((await post({ address: ADDRESS }, "outsider")).status).toBe(403);
  });

  it("answers with the site report", async () => {
    const res = await post({ address: ADDRESS }, "team-token");
    expect(res.status).toBe(200);
    const report = (await res.json()) as SiteReport;
    expect(report.steps.parcel.data?.apn).toBe("200-030-023");
    expect(JSON.stringify(report)).not.toContain(KEY);
  });

  it("refuses an empty address", async () => {
    expect((await post({ address: "" }, "team-token")).status).toBe(400);
  });

  it("answers 503 when the server has no sign-in check", async () => {
    const bare = createApp({});
    await new Promise<void>((resolve) => bare.listen(0, "127.0.0.1", resolve));
    const res = await fetch(`http://127.0.0.1:${(bare.address() as AddressInfo).port}/api/site/report`, { method: "POST", body: "{}" });
    expect(res.status).toBe(503);
    await new Promise<void>((resolve) => bare.close(() => resolve()));
  });

  it("forwards a signed image without storing it, and refuses an unsigned one", async () => {
    const path = imagePath({ kind: "streetview", pano: "P1", heading: "90", pitch: "0", fov: "90", size: "640x400" }, KEY);
    const ok = await fetch(`${base}${path}`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/jpeg");
    expect(new Uint8Array(await ok.arrayBuffer())).toEqual(new Uint8Array([0xff, 0xd8, 0xff]));
    const bad = await fetch(`${base}${path.replace("heading=90", "heading=91")}`);
    expect(bad.status).toBe(403);
  });
});

describe("site report for the chat assistant", () => {
  it("gives Claude every fact with its source, so it can answer fire zone questions", async () => {
    const report = await buildSiteReport(ADDRESS, { apiKey: KEY, fetch: fakeFetch({ parcelPointHit: true }).fetch, now: NOW });
    const text = siteReportText(report);
    expect(text).toContain("CAL FIRE hazard zone: not in a mapped Fire Hazard Severity Zone; responsibility area LRA");
    expect(text).toContain("CBC Chapter 7A (WUI): not indicated by the state maps");
    expect(text).toContain("FEMA flood zone: Zone X");
    expect(text).toContain("APN 200-030-023");
    expect(text).toContain("California energy code climate zone 12");
    expect(text).toContain("liquefaction zone: no");
    expect(text).toContain("CAL FIRE State Responsibility Areas, read 2026-11-05: https://services1.arcgis.com/");
    expect(text).toContain("https://danville.ca.gov/540/Zoning-Ordinance-Map");
    expect(text).not.toContain(KEY);
    expect(siteSummary(report)).toContain("Town of Danville");
  });

  it("names the failed steps and says when there is no report", async () => {
    const report = await buildSiteReport(ADDRESS, { fetch: fakeFetch({ fail: { "hazards.fema.gov": 500 } }).fetch, now: NOW });
    const text = siteReportText(report);
    expect(text).toContain("FEMA flood zone: FAILED (The source answered with HTTP 500.)");
    expect(text).toMatch(/Failed steps: .*FEMA flood zone/);
    expect(siteReportText(null)).toContain("no site report yet");
  });

  it("runs as a read-only tool", async () => {
    expect(READ_SITE_REPORT_TOOL.name).toBe("read_site_report");
    expect(await runReadSiteReport(async () => null)).toEqual({ content: siteReportText(null), isError: false });
    const broken = await runReadSiteReport(async () => {
      throw new Error("firestore down");
    });
    expect(broken.isError).toBe(true);
  });

  it("is one of Claude's chat tools and reads the project's saved report", async () => {
    expect(TOOL_SPECS.map((t) => t.name)).toContain("read_site_report");
    const store = new MemoryChatStore();
    const project = { id: "p1", name: "El Rio", address: ADDRESS, jurisdiction: "Town of Danville", aduType: "No ADU" };
    store.addProject(project);
    const ctx = { store, projectId: "p1", chatId: "c1", project, set: null, updatedBy: "Ana", onArtifact: () => undefined };
    expect((await runTool("read_site_report", {}, ctx)).content).toContain("no site report yet");
    const report = await buildSiteReport(ADDRESS, { apiKey: KEY, fetch: fakeFetch({ parcelPointHit: true }).fetch, now: NOW });
    store.siteReports.set("p1", report);
    const answer = await runTool("read_site_report", {}, ctx);
    expect(answer.isError).toBe(false);
    expect(answer.content).toContain("CAL FIRE hazard zone");
    expect(answer.content).toContain("APN 200-030-023");
  });

  it("reads only a well-formed report from Firestore", () => {
    expect(siteReportFrom(undefined)).toBeNull();
    expect(siteReportFrom({ version: 2, address: ADDRESS, generatedAt: "x", steps: {} })).toBeNull();
    expect(siteReportFrom({ version: 1, address: ADDRESS, generatedAt: "2026-11-05", steps: {} })).not.toBeNull();
  });
});

describe("slow and flaky sources", () => {
  const answers = (...steps: Array<number | "hang">) => {
    let calls = 0;
    const doFetch: Fetch = async (_input, init) => {
      const step = steps[Math.min(calls++, steps.length - 1)];
      if (step === "hang") {
        return new Promise<Response>((_resolve, reject) =>
          init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("timed out"), { name: "TimeoutError" }))),
        );
      }
      if (step === 0) throw new TypeError("fetch failed");
      return new Response(JSON.stringify(step === 200 ? { value: 417.9 } : { error: "down" }), { status: step });
    };
    return { fetch: doFetch, calls: () => calls };
  };

  it("tries again after HTTP 5xx or an unreachable source, then answers", async () => {
    const http = answers(500, 0, 200);
    await expect(getJson("https://example.test", { fetch: http.fetch, retries: 2, retryDelayMs: 0 })).resolves.toEqual({ value: 417.9 });
    expect(http.calls()).toBe(3);
  });

  it("gives up after the last try with the source's own message", async () => {
    const http = answers(503);
    await expect(getJson("https://example.test", { fetch: http.fetch, retries: 1, retryDelayMs: 0 })).rejects.toThrow("HTTP 503");
    expect(http.calls()).toBe(2);
  });

  it("does not try again after a timeout or HTTP 4xx", async () => {
    const slow = answers("hang", 200);
    await expect(getJson("https://example.test", { fetch: slow.fetch, timeoutMs: 20, retries: 1, retryDelayMs: 0 })).rejects.toThrow("did not answer in time");
    expect(slow.calls()).toBe(1);
    const denied = answers(403, 200);
    await expect(getJson("https://example.test", { fetch: denied.fetch, retries: 1, retryDelayMs: 0 })).rejects.toThrow("HTTP 403");
    expect(denied.calls()).toBe(1);
  });

  it("does not try again by default", async () => {
    const http = answers(500, 200);
    await expect(getJson("https://example.test", { fetch: http.fetch })).rejects.toThrow("HTTP 500");
    expect(http.calls()).toBe(1);
  });

  it("the elevation step survives one USGS HTTP 500", async () => {
    const fake = fakeFetch();
    let usgsCalls = 0;
    const flaky: Fetch = async (input, init) => {
      if (String(input).includes("epqs.nationalmap.gov") && usgsCalls++ === 0) {
        return new Response(JSON.stringify({ message: "Internal server error" }), { status: 500 });
      }
      return fake.fetch(input, init);
    };
    const report = await buildSiteReport(ADDRESS, { apiKey: KEY, fetch: flaky, now: NOW, retryDelayMs: 0 });
    expect(report.steps.elevation).toMatchObject({ status: "ok", data: { feet: 417.9 } });
    expect(usgsCalls).toBe(2);
  });

  // The live Google answer for 428 El Rio Rd (2026-11-05): 126.05 m.
  const googleElevation = { status: "OK", results: [{ elevation: 126.0508499145508, resolution: 4.77 }] };
  const withGoogleElevation = (usgs: number, google: unknown = googleElevation) => {
    const fake = fakeFetch({ fail: { "epqs.nationalmap.gov": usgs } });
    const urls: string[] = [];
    const doFetch: Fetch = async (input, init) => {
      if (String(input).includes("maps/api/elevation")) {
        urls.push(String(input));
        return new Response(JSON.stringify(google), { status: 200 });
      }
      return fake.fetch(input, init);
    };
    return { fetch: doFetch, googleUrls: urls };
  };

  it("reads a Google Elevation answer in feet", () => {
    expect(parseGoogleElevation(googleElevation)).toEqual({ feet: 413.6 });
    expect(() => parseGoogleElevation({ status: "REQUEST_DENIED", error_message: "API not enabled" })).toThrow(/REQUEST_DENIED: API not enabled/);
    expect(() => parseGoogleElevation(null)).toThrow(SourceError);
  });

  it("falls back to Google Elevation when USGS fails, and says so", async () => {
    const http = withGoogleElevation(500);
    const report = await buildSiteReport(ADDRESS, { apiKey: KEY, fetch: http.fetch, now: NOW, retryDelayMs: 0 });
    const e = report.steps.elevation;
    expect(e).toMatchObject({ status: "ok", data: { feet: 413.6 } });
    expect(e.note).toBe("USGS failed (The source answered with HTTP 500); the Google Elevation API was used.");
    expect(e.sources.map((s) => s.name)).toEqual(["USGS Elevation Point Query Service", "Google Elevation API"]);
    // The stored source link never carries the key.
    expect(e.sources[1]!.url).not.toContain(KEY);
    expect(http.googleUrls).toHaveLength(1);
  });

  it("does not ask Google when USGS answers", async () => {
    const http = withGoogleElevation(0);
    const fake = fakeFetch();
    const report = await buildSiteReport(ADDRESS, {
      apiKey: KEY,
      fetch: (input, init) => (String(input).includes("epqs") ? fake.fetch(input, init) : http.fetch(input, init)),
      now: NOW,
    });
    expect(report.steps.elevation).toMatchObject({ status: "ok", data: { feet: 417.9 } });
    expect(report.steps.elevation.note).toBeUndefined();
    expect(http.googleUrls).toHaveLength(0);
  });

  it("keeps the USGS failure without a Google key", async () => {
    const http = withGoogleElevation(500);
    const report = await buildSiteReport(ADDRESS, { fetch: http.fetch, now: NOW, retryDelayMs: 0 });
    expect(report.steps.elevation).toMatchObject({ status: "failed", error: "The source answered with HTTP 500." });
    expect(http.googleUrls).toHaveLength(0);
  });

  it("names both failures when Google fails too", async () => {
    const http = withGoogleElevation(500, { status: "REQUEST_DENIED" });
    const report = await buildSiteReport(ADDRESS, { apiKey: KEY, fetch: http.fetch, now: NOW, retryDelayMs: 0 });
    expect(report.steps.elevation).toMatchObject({
      status: "failed",
      error: "USGS failed (The source answered with HTTP 500), and so did Google (Google Elevation answered REQUEST_DENIED).",
    });
  });
});
