import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Assistant } from "./assistant";
import { MemoryStore } from "./memoryStore";
import { Workspace } from "./Workspace";
import { memoryRouter } from "./router";
import { fakeCheck, PAGES } from "./fixtures.test-utils";
import { createSiteApi, type SiteApi } from "../site/siteApi";
import { isSiteReport, type SiteReport, type Step } from "../site/types";
import { siteReportMarkdown } from "../site/siteMarkdown";

const AHK = { uid: "u1", email: "ahk.archteam@gmail.com", name: "Ahk" };
const ADDRESS = "428 El Rio Rd, Danville, CA 94526";
const READ = "2026-11-05T18:00:00.000Z";

afterEach(cleanup);

// Steps with a summary but no data, like reports saved before the data fields existed.
const ok = (summary: string, source: string, url: string, extra: Partial<Step<never>> = {}): Step<never> => ({
  status: "ok",
  summary,
  sources: [{ name: source, url, fetchedAt: READ }],
  ...extra,
});

/** A report like the API's answer for 428 El Rio Rd, with the FEMA step failed. */
function elRioReport(): SiteReport {
  const sv = (heading: number, label: string) => ({ path: `/api/site/image?kind=streetview&pano=P1&heading=${heading}&sig=s${heading}`, label, heading });
  return {
    version: 1,
    address: ADDRESS,
    generatedAt: READ,
    links: {
      maps: "https://www.google.com/maps/search/?api=1&query=37.832320,-122.000470",
      streetView: "https://www.google.com/maps/@?api=1&map_action=pano&pano=P1",
      earth: "https://earth.google.com/web/@37.832320,-122.000470,120a,250d,35y,0h,45t,0r",
    },
    steps: {
      geocode: ok("428 El Rio Rd, Danville, CA 94526, USA", "Google Geocoding API", "https://maps.googleapis.com/maps/api/geocode/json?address=428"),
      streetView: {
        status: "ok",
        sources: [{ name: "Google Street View Static API (metadata)", url: "https://maps.googleapis.com/maps/api/streetview/metadata", fetchedAt: READ }],
        data: {
          copyright: "© Google",
          date: "2023-05",
          images: [sv(140, "Facing the property"), sv(230, "Right of the property"), sv(320, "Away from the property"), sv(50, "Left of the property")],
        },
      },
      satellite: {
        status: "ok",
        sources: [{ name: "Google Maps Static API (satellite)", url: "https://maps.googleapis.com/maps/api/staticmap", fetchedAt: READ }],
        data: {
          copyright: "Imagery © Google",
          images: [
            { path: "/api/site/image?kind=satellite&zoom=18&sig=a", label: "Satellite, neighborhood", zoom: 18 },
            { path: "/api/site/image?kind=satellite&zoom=20&sig=b", label: "Satellite, close", zoom: 20 },
          ],
        },
      },
      solar: ok("roof 3364 sq ft", "Google Solar API (buildingInsights)", "https://solar.googleapis.com/v1/buildingInsights:findClosest"),
      parcel: ok("APN 200-030-023 (Contra Costa County)", "Contra Costa County Assessor parcels (CCMAP)", "https://gis.cccounty.us/arcgis/rest/services/CCMAP/Assessment_Parcels_ArcPro/MapServer/0/query"),
      jurisdiction: ok("Town of Danville (incorporated)", "US Census TIGERweb incorporated places", "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer/4/query"),
      zoning: {
        status: "unknown",
        sources: [],
        note: "Town of Danville has no public zoning map service we can read. Check the zoning district on its map.",
        summary: "zoning district unknown; zoning map: https://danville.ca.gov/540/Zoning-Ordinance-Map",
        checkUrl: "https://danville.ca.gov/540/Zoning-Ordinance-Map",
      },
      flood: {
        status: "failed",
        error: "The source answered with HTTP 500.",
        sources: [{ name: "FEMA National Flood Hazard Layer", url: "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query", fetchedAt: READ }],
        checkUrl: "https://msc.fema.gov/portal/search?AddressQuery=428",
      },
      fire: ok(
        "not in a mapped Fire Hazard Severity Zone; responsibility area LRA; CBC Chapter 7A (WUI): not indicated by the state maps",
        "CAL FIRE State Responsibility Areas",
        "https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/arcgis/rest/services/State_Responsibility_Area/FeatureServer/0/query",
      ),
      seismic: ok("liquefaction zone: no; landslide zone: no; Alquist-Priolo fault zone: no", "CGS Seismic Hazard Zones: liquefaction", "https://services2.arcgis.com/x/query"),
      elevation: ok("417.9 ft above sea level", "USGS Elevation Point Query Service", "https://epqs.nationalmap.gov/v1/json?x=-122"),
      climateZone: ok("California energy code climate zone 12", "California Energy Commission building climate zones", "https://services3.arcgis.com/x/query"),
    },
  };
}

function fakeSite(build: SiteApi["buildReport"]) {
  const buildReport = vi.fn(build);
  const site: SiteApi = { buildReport, imageUrl: (path: string) => `https://api.example.test${path}` };
  return { site, buildReport };
}

function mount(store: MemoryStore, site?: SiteApi) {
  const assistant = new Assistant({ store, extractPages: async () => PAGES, check: fakeCheck, pause: async () => undefined });
  const { container } = render(<Workspace store={store} assistant={assistant} user={AHK} site={site} router={memoryRouter()} />);
  return within(container);
}

async function createProject(view: ReturnType<typeof mount>) {
  fireEvent.click(view.getAllByRole("button", { name: "New project" })[0]);
  const form = within(view.getByRole("form", { name: "New project" }));
  fireEvent.change(form.getByLabelText("Project name"), { target: { value: "El Rio ADU" } });
  fireEvent.change(form.getByLabelText("Project address"), { target: { value: ADDRESS } });
  fireEvent.change(form.getByLabelText("Jurisdiction"), { target: { value: "City of San Ramon" } });
  fireEvent.click(form.getByRole("button", { name: "Create project" }));
  await view.findByRole("link", { name: /^El Rio ADU/ });
}

describe("Site section", () => {
  it("builds the site report when a project is created, saves it, and shows images, links and facts with sources", async () => {
    const store = new MemoryStore();
    const { site, buildReport } = fakeSite(async () => elRioReport());
    const view = mount(store, site);
    await createProject(view);

    // The project id goes along, so the server saves the site facts snapshot on the project.
    const projectId = [...store.projects.keys()][0]!;
    await waitFor(() => expect(buildReport).toHaveBeenCalledWith(ADDRESS, projectId));
    const section = within(await view.findByRole("region", { name: "Site" }));
    await section.findByRole("list", { name: "Open the site in Google" });

    // Saved on the project, where the chat assistant reads it.
    expect(store.siteReports.get(projectId)?.steps.parcel.summary).toContain("200-030-023");

    // Up to four Street View images, live from the API with the Google attribution; two satellite images.
    const street = within(section.getByRole("figure", { name: "Street View" }));
    const images = street.getAllByRole("img") as HTMLImageElement[];
    expect(images).toHaveLength(4);
    expect(images[0]!.src).toBe("https://api.example.test/api/site/image?kind=streetview&pano=P1&heading=140&sig=s140");
    expect(images[0]!.alt).toBe("Street View: Facing the property");
    expect(street.getByText("© Google · captured 2023-05")).toBeTruthy();
    const sat = within(section.getByRole("figure", { name: "Satellite view" }));
    expect(sat.getAllByRole("img")).toHaveLength(2);
    expect(sat.getByText("Imagery © Google")).toBeTruthy();

    const links = within(section.getByRole("list", { name: "Open the site in Google" }));
    expect(links.getByRole("link", { name: "Open in Google Earth" }).getAttribute("href")).toContain("earth.google.com/web/@37.832320");
    expect(links.getByRole("link", { name: "Open in Street View" }).getAttribute("href")).toContain("map_action=pano");
    expect(links.getByRole("link", { name: "Open in Google Maps" })).toBeTruthy();

    // Facts with their source and the date it was read; the failed step says so.
    const facts = section.getByRole("list", { name: "Site facts" });
    expect(facts.textContent).toContain("not in a mapped Fire Hazard Severity Zone");
    expect(facts.textContent).toContain("read 2026-11-05");
    expect(within(facts).getByRole("link", { name: "CAL FIRE State Responsibility Areas" }).getAttribute("href")).toContain(
      "State_Responsibility_Area",
    );
    expect(facts.textContent).toContain("The source answered with HTTP 500.");
    expect(section.getByText("1 step failed")).toBeTruthy();
    expect(within(facts).getAllByRole("link", { name: "Check by hand" })[0]!.getAttribute("href")).toContain("danville.ca.gov");

    // Refresh runs the pipeline again.
    fireEvent.click(section.getByRole("button", { name: "Refresh site info" }));
    await waitFor(() => expect(buildReport).toHaveBeenCalledTimes(2));
  });

  it("shows why a refresh failed and keeps the empty state", async () => {
    const store = new MemoryStore();
    const { site } = fakeSite(async () => {
      throw new Error("Sign in again, then retry.");
    });
    const view = mount(store, site);
    await createProject(view);
    const section = within(await view.findByRole("region", { name: "Site" }));
    expect((await section.findByRole("alert")).textContent).toContain("Sign in again, then retry.");
    expect(section.getByText("No site report yet.", { exact: false })).toBeTruthy();
    expect((section.getByRole("button", { name: "Refresh site info" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("says when the service is not connected, and still shows a saved report", async () => {
    const store = new MemoryStore();
    const view = mount(store);
    await createProject(view);
    const projectId = [...store.projects.keys()][0]!;
    const section = within(await view.findByRole("region", { name: "Site" }));
    expect(section.getByText(/not connected to this dashboard/).getAttribute("role")).toBe("status");
    expect((section.getByRole("button", { name: "Refresh site info" }) as HTMLButtonElement).disabled).toBe(true);

    await store.saveSiteReport(projectId, elRioReport());
    expect((await section.findAllByText("Town of Danville (incorporated)")).length).toBeGreaterThan(0);
    expect(screen.queryAllByRole("img")).toHaveLength(0);
  });
});

describe("Site report document", () => {
  it("writes the site info as an editable document in Documents, and adds a version on refresh", async () => {
    const store = new MemoryStore();
    const { site, buildReport } = fakeSite(async () => elRioReport());
    const view = mount(store, site);
    await createProject(view);
    const projectId = [...store.projects.keys()][0]!;

    const section = within(await view.findByRole("region", { name: "Site" }));
    const edit = await section.findByRole("link", { name: "Edit as document" });
    const artifact = [...store.artifacts.values()].find((a) => !a.chatId)!;
    expect(artifact.title).toBe(`Site report: ${ADDRESS}`);
    expect(artifact.kind).toBe("document");
    expect(artifact.version).toBe(1);
    expect(artifact.content).toContain("| Parcel (APN) | APN 200-030-023 (Contra Costa County) |");
    expect(artifact.content).toContain("| Flood (FEMA) | Not read |");
    expect(edit.getAttribute("href")).toBe(`#/projects/${projectId}/artifacts/${encodeURIComponent(artifact.id)}`);

    // The team edits it; a refresh writes a new version and keeps the edit in the history.
    await store.commitVersion(projectId, artifact.id, { title: artifact.title, content: "Our notes", updatedBy: "Ahk" });
    fireEvent.click(section.getByRole("button", { name: "Refresh site info" }));
    await waitFor(() => expect(buildReport).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(store.artifacts.get(artifact.id)?.version).toBe(3));
    expect(store.versions.get(artifact.id)?.map((v) => v.content)).toContain("Our notes");

    // It opens on its own page, and is listed in the project's Documents.
    fireEvent.click(edit);
    expect(await view.findByRole("article", { name: `Site report: ${ADDRESS}` })).toBeTruthy();
    fireEvent.click(view.getByRole("link", { name: "El Rio ADU" }));
    fireEvent.click((await view.findAllByRole("link", { name: "Documents" }))[0]!);
    const table = within(await view.findByRole("table"));
    expect(table.getByRole("link", { name: `Open Site report: ${ADDRESS}` }).getAttribute("href")).toContain("/artifacts/");
    expect(table.getByText("Site info for the project address")).toBeTruthy();
  });

  it("turns a report into markdown tables that keep cells whole", () => {
    const report = elRioReport();
    report.steps.zoning = { status: "ok", sources: [], data: { district: "R-6 | single family", description: "Line one\nline two" } };
    const md = siteReportMarkdown(report);
    expect(md.startsWith(`# Site report: ${ADDRESS}`)).toBe(true);
    expect(md).toContain("| Zoning | R-6 \\| single family, Line one line two |");
    expect(md).toContain("**Not read:** FEMA flood zone");
    expect(md).toContain("## Sources");
    expect(md).toContain("check by hand at https://msc.fema.gov/portal/search?AddressQuery=428");
  });
});

describe("site API client", () => {
  it("sends the address with the team member's ID token and checks the answer", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(elRioReport()), { status: 200 }));
    const api = createSiteApi({ baseUrl: "https://chat-api.example.test/", getIdToken: async () => "id-token", fetch });
    const report = await api.buildReport(ADDRESS);
    expect(isSiteReport(report)).toBe(true);
    expect(fetch).toHaveBeenCalledWith("https://chat-api.example.test/api/site/report", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer id-token" },
      body: JSON.stringify({ address: ADDRESS }),
    });
    await api.buildReport(ADDRESS, "p1");
    expect(fetch).toHaveBeenLastCalledWith("https://chat-api.example.test/api/site/report", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer id-token" },
      body: JSON.stringify({ address: ADDRESS, projectId: "p1" }),
    });
    expect(api.imageUrl("/api/site/image?kind=satellite&sig=x")).toBe("https://chat-api.example.test/api/site/image?kind=satellite&sig=x");
  });

  it("gives plain reasons when it cannot run", async () => {
    const denied = createSiteApi({
      baseUrl: "https://chat-api.example.test",
      getIdToken: async () => "id-token",
      fetch: async () => new Response(JSON.stringify({ error: "This account may not use the dashboard." }), { status: 403 }),
    });
    await expect(denied.buildReport(ADDRESS)).rejects.toThrow("This account may not use the dashboard.");
    const unset = createSiteApi({ baseUrl: "", getIdToken: async () => "id-token" });
    await expect(unset.buildReport(ADDRESS)).rejects.toThrow("not set up");
    const signedOut = createSiteApi({ baseUrl: "https://chat-api.example.test", getIdToken: async () => null });
    await expect(signedOut.buildReport(ADDRESS)).rejects.toThrow("Sign in again");
    const garbled = createSiteApi({
      baseUrl: "https://chat-api.example.test",
      getIdToken: async () => "id-token",
      fetch: async () => new Response(JSON.stringify({ hello: "world" }), { status: 200 }),
    });
    await expect(garbled.buildReport(ADDRESS)).rejects.toThrow("cannot read");
  });
});
