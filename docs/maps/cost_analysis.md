# Map Infrastructure Cost Analysis & Classification

This document provides a full cost breakdown and classification for every mapping infrastructure component in GoTogetherRides.

---

## Component Cost Classification Table

| Component | Technology | Cost Classification | Details / Notes |
|---|---|---|---|
| **Map Rendering Client** | MapLibre GL JS | `FREE OPEN-SOURCE SOFTWARE` | BSD-3-Clause open source license. Zero licensing fee. |
| **Vector Map Format** | PMTiles | `FREE OPEN-SOURCE SOFTWARE` | Cloud-optimized single-file format. Zero server cost. |
| **Map Data** | OpenStreetMap | `FREE OPEN DATA` | ODbL license. Requires explicit attribution. |
| **PMTiles Hosting** | Cloudflare R2 / AWS S3 | `FREE AT SMALL SCALE` / `POTENTIALLY PAID AT SCALE` | Free tier on R2 (10 GB storage, 10M requests/mo). Bandwidth ~\$0.015/GB beyond free tier. |
| **Routing Service (Dev)** | Public OSRM | `FREE AT SMALL SCALE` | Public demo server for dev/testing only. Rate limited. |
| **Routing Service (Prod)** | Self-Hosted OSRM | `REQUIRES HOSTING` | Requires VPS/EC2 (2 vCPU, 4GB RAM = ~\$15-30/mo for region). |
| **Geocoder (Dev)** | Public Nominatim | `FREE AT SMALL SCALE` | Strictly 1 request/sec rate limit. Requires custom User-Agent. |
| **Geocoder (Prod)** | Self-Hosted Nominatim | `REQUIRES HOSTING` | Requires VPS/EC2 (4 vCPU, 8GB RAM + NVMe SSD = ~\$40-80/mo). |
| **Caching Layer** | Node In-Memory Cache | `FREE OPEN-SOURCE SOFTWARE` | Zero additional cost. Included in application server memory. |
| **Satellite Imagery** | Optional Open Aerial / Sentinel | `FREE AT SMALL SCALE` / `OPTIONAL` | Optional aerial tiles where open licenses apply. |

---

## Detailed Financial Projections

### Phase 1: MVP / Low Scale (< 10,000 monthly active users)
- **Map Vector Tiles (R2/Vercel)**: \$0.00 / month
- **Public OSRM & Nominatim (cached)**: \$0.00 / month
- **Total Infrastructure Cost**: **\$0.00 / month**

### Phase 2: Moderate Production Scale (10,000 - 100,000 monthly users)
- **Static PMTiles CDN Bandwidth**: ~\$2.00 / month (50 GB transfer)
- **Self-Hosted OSRM Instance (DigitalOcean / Hetzner)**: ~\$15.00 / month
- **Cached Nominatim / Mappls fallback**: ~\$25.00 / month
- **Total Infrastructure Cost**: **~\$42.00 / month**

### Phase 3: High Production Scale (> 500,000 monthly users)
- **Global PMTiles CDN**: ~\$15.00 / month
- **Load-Balanced OSRM Cluster**: ~\$60.00 / month
- **Dedicated Nominatim / Pelias Cluster**: ~\$120.00 / month
- **Total Infrastructure Cost**: **~\$195.00 / month**

---

## Critical Cost & Operational Drivers
1. **OSRM Memory Usage**: OSRM keeps road network graph in RAM. Large datasets (e.g. all of India) require ~8-12 GB RAM. Regional extracts (e.g. Telangana) require < 1.5 GB RAM.
2. **Nominatim SSD IOPS**: Nominatim relies heavily on PostgreSQL/PostGIS. NVMe SSD storage is required for fast spatial indexing.
3. **No Blanket Free Guarantee**: While open-source software is free, hosting, bandwidth, and CPU/RAM resources require operational budgeting as traffic scales.
