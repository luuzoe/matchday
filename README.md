# Matchday

A mobile-first football scores and news PWA with an emerald-and-white Ball+M identity, bilingual English/Burmese interface, live match views, competition tables and fixtures.

**Live website:** https://luuzoe.github.io/matchday/

## Data and source notes

Matchday only displays football information returned by its listed sources. ESPN public feeds provide scores, match details, news, competition seasons, standings and any available transfer records. OpenLigaDB is used only where the site labels its licensed standings or recorded goal-scorer data; scorer coverage can be incomplete. Cached data is marked with its source and update time, and missing feeds are shown as unavailable rather than filled with invented information. Team of the Week is marked unavailable when no suitable reusable source exists.

News cards preserve source-provided text and images. BBC items link to their individual articles; Sky Sports cards link only to the Sky Sports football landing page, not to individual Sky article URLs.

Matchday is an independent project and is not affiliated with FotMob, ESPN, BBC, Sky Sports, OpenLigaDB or any competition organizer. Third-party names and marks belong to their respective owners.

## Run locally

Serve this folder over HTTP (service workers require a secure context):

```sh
python3 -m http.server 8080
```

Then open `http://localhost:8080/`.

## Data refresh

A GitHub Actions workflow refreshes public ESPN snapshots and monitors known score groups every five minutes; the full current-season fixture list is resynchronized every ten minutes so newly listed fixtures are discovered. League caches track freshness independently, preserving prior data when an individual ESPN feed fails. Successful snapshots can still publish when another source fails, but the workflow run is marked failed so the issue is visible. The site uses GitHub Pages from the `main` branch root. No paid hosting or Cloudflare service is enabled by this repository.
