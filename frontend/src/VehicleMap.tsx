import { useEffect, useRef, useState } from "react";
import type { FilterSpecification, Map as MapLibreMap, StyleSpecification } from "maplibre-gl";

// Carte réelle centrée sur la voiture : tuiles OpenFreeMap (OpenStreetMap), dessinées
// avec les couleurs du design. MapLibre n'est chargé qu'au premier affichage de la carte.

const ZOOM = 15.6;

function mapStyle(dark: boolean): StyleSpecification {
  const c = dark
    ? { bg: "#252b27", water: "#1b2420", park: "#28332a", building: "#2c322e", minor: "#3a423c", road: "#4a534c", major: "#5f6a61", rail: "#3a423c" }
    : { bg: "#e4e8e1", water: "#c5d3cf", park: "#d3dfc8", building: "#d8dcd5", minor: "#ffffff", road: "#ffffff", major: "#fbfbf7", rail: "#c9cec6" };
  const width = (min: number, max: number) =>
    ["interpolate", ["exponential", 1.6], ["zoom"], 13, min, 18, max] as unknown as number;
  const classIn = (...classes: string[]) =>
    ["in", ["get", "class"], ["literal", classes]] as unknown as FilterSpecification;
  const roundLines = { "line-cap": "round", "line-join": "round" } as const;
  return {
    version: 8,
    sources: { omt: { type: "vector", url: "https://tiles.openfreemap.org/planet" } },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": c.bg } },
      { id: "park", type: "fill", source: "omt", "source-layer": "park", paint: { "fill-color": c.park } },
      {
        id: "landcover", type: "fill", source: "omt", "source-layer": "landcover",
        filter: classIn("grass", "wood"), paint: { "fill-color": c.park, "fill-opacity": 0.7 },
      },
      { id: "water", type: "fill", source: "omt", "source-layer": "water", paint: { "fill-color": c.water } },
      { id: "waterway", type: "line", source: "omt", "source-layer": "waterway", paint: { "line-color": c.water, "line-width": width(1, 6) } },
      { id: "building", type: "fill", source: "omt", "source-layer": "building", minzoom: 14, paint: { "fill-color": c.building } },
      {
        id: "rail", type: "line", source: "omt", "source-layer": "transportation", filter: classIn("rail"),
        paint: { "line-color": c.rail, "line-width": width(0.6, 2), "line-dasharray": [3, 3] },
      },
      {
        id: "minor", type: "line", source: "omt", "source-layer": "transportation",
        filter: classIn("service", "track", "path", "pedestrian"), layout: roundLines,
        paint: { "line-color": c.minor, "line-width": width(0.5, 5) },
      },
      {
        id: "road", type: "line", source: "omt", "source-layer": "transportation",
        filter: classIn("minor", "tertiary"), layout: roundLines,
        paint: { "line-color": c.road, "line-width": width(1.2, 12) },
      },
      {
        id: "major", type: "line", source: "omt", "source-layer": "transportation",
        filter: classIn("primary", "secondary", "trunk", "motorway"), layout: roundLines,
        paint: { "line-color": c.major, "line-width": width(2.2, 20) },
      },
    ],
  };
}

export function VehicleMap({ latitude, longitude, dark }: { latitude: number; longitude: number; dark: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const [failed, setFailed] = useState(false);

  // création (une seule fois)
  useEffect(() => {
    let cancelled = false;
    let resizeObs: ResizeObserver | null = null;
    (async () => {
      try {
        const [{ default: maplibregl }] = await Promise.all([
          import("maplibre-gl"),
          import("maplibre-gl/dist/maplibre-gl.css"),
        ]);
        if (cancelled || !container.current) return;
        map.current = new maplibregl.Map({
          container: container.current,
          style: mapStyle(dark),
          center: [longitude, latitude],
          zoom: ZOOM,
          interactive: false,
          attributionControl: false,
          fadeDuration: 0,
        });
        // la carte d'accueil peut s'agrandir (carte dépliée) : suivre la taille du conteneur
        if (typeof ResizeObserver !== "undefined") {
          resizeObs = new ResizeObserver(() => map.current?.resize());
          resizeObs.observe(container.current);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      resizeObs?.disconnect();
      map.current?.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    map.current?.jumpTo({ center: [longitude, latitude] });
  }, [latitude, longitude]);

  useEffect(() => {
    map.current?.setStyle(mapStyle(dark));
  }, [dark]);

  if (failed) return null; // on garde le dessin du design en dessous
  return (
    <>
      <div className="map-gl" ref={container} />
      <div className="map-attribution">
        © <a href="https://openfreemap.org" rel="noreferrer" target="_blank">OpenFreeMap</a> ©{" "}
        <a href="https://www.openstreetmap.org/copyright" rel="noreferrer" target="_blank">OpenStreetMap</a>
      </div>
    </>
  );
}
