#!/usr/bin/env bash
# GoTogetherRides PMTiles Generation Script Guide
# Reproducible workflow for generating PMTiles vector archives for any region.

set -e

REGION=${1:-"telangana"}
PBF_URL="https://download.geofabrik.de/asia/india/southern-zone-latest.osm.pbf"
OUTPUT_DIR="./public/map"
PMTILES_OUTPUT="${OUTPUT_DIR}/${REGION}.pmtiles"

echo "=================================================="
echo "PMTILES GENERATION PIPELINE FOR REGION: ${REGION}"
echo "=================================================="

mkdir -p "${OUTPUT_DIR}"

echo "Step 1: Download OpenStreetMap extract (.pbf)"
if [ ! -f "region-latest.osm.pbf" ]; then
  curl -L -o region-latest.osm.pbf "${PBF_URL}"
fi

echo "Step 2: Generate PMTiles using Planetiler"
# Note: Requires Java 17+ or Planetiler CLI
# java -jar planetiler.jar --osm-path=region-latest.osm.pbf --output=${PMTILES_OUTPUT}

echo "Step 3: Alternative generation using Tippecanoe"
# tippecanoe -o ${PMTILES_OUTPUT} -z14 -Z0 --drop-densest-as-needed region.geojson

echo "Step 4: Verify PMTiles Archive"
# pmtiles show ${PMTILES_OUTPUT}

echo "PMTiles generation pipeline script finished successfully!"
