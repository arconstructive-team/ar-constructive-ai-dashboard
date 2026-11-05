# Site report fixtures: 428 El Rio Rd, Danville, CA 94526

Answers recorded on 2026-11-05 from the public sources the site pipeline reads, trimmed to the
fields the parsers use. The tests replay them through a fake `fetch`, so they need no network.

| File | Source | Recorded or synthetic |
| --- | --- | --- |
| `census-geocode.json` | US Census Geocoder, geographies/onelineaddress | recorded |
| `parcel-point-empty.json` | Contra Costa CCMAP Assessment_Parcels_ArcPro, point query at the Census point | recorded (the Census point lies in the street, about 370 m from the lot) |
| `parcel-address.json` | the same layer, address query `full_address_search LIKE '428 EL RIO%'`, outSR 4326 | recorded |
| `tiger-place.json` | US Census TIGERweb incorporated places (layer 4) | recorded |
| `county-zoning-empty.json` | Contra Costa County zoning layer | recorded (Danville is incorporated, so the county layer is empty) |
| `fema-flood.json` | FEMA NFHL layer 28 | recorded |
| `calfire-fhsz-empty.json` | CAL FIRE fhsz24_5 (FHSZ in SRA and LRA) | recorded (no zone at this point) |
| `calfire-sra.json` | CAL FIRE State_Responsibility_Area | recorded |
| `cgs-empty.json` | CGS liquefaction, landslide and Alquist-Priolo layers (all three answered the same) | recorded |
| `epqs.json` | USGS Elevation Point Query Service | recorded |
| `cec-climate.json` | CEC BuildingClimateZones_CEC_2015 | recorded |
| `google-geocode.json` | Google Geocoding API | synthetic: shaped like Google's documented answer; the point is the centre of the recorded parcel |
| `streetview-metadata.json` | Google Street View metadata | synthetic, documented shape |
| `solar-building-insights.json` | Google Solar API buildingInsights:findClosest | synthetic, documented shape |

The Google answers are synthetic because the company's Google Maps key is not set up yet. Replace
them with recorded answers once it is.
