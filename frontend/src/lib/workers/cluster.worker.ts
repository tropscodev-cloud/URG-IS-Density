/// <reference lib="webworker" />
import Supercluster, { type ClusterFeature, type PointFeature } from 'supercluster';

interface PointProps {
  cameraId: string;
  headcount: number;
  severity: number;
  status: string;
}

interface ClusterProps {
  headcount: number;
  severity: number;
}

interface RefreshMessage {
  type: 'refresh';
  requestId: number;
  points: Array<{ id: string; lat: number; lng: number; headcount: number; severity: number; status: string }>;
  bbox: [number, number, number, number];
  zoom: number;
}

export interface OutputFeature {
  isCluster: boolean;
  lng: number;
  lat: number;
  headcount: number;
  severity: number;
  count: number;
  cameraId?: string;
  status?: string;
  clusterId?: number;
}

let index: Supercluster<PointProps, ClusterProps> | null = null;

self.onmessage = (e: MessageEvent<RefreshMessage>) => {
  const msg = e.data;
  if (msg.type !== 'refresh') return;

  index = new Supercluster<PointProps, ClusterProps>({
    radius: 64,
    maxZoom: 17,
    map: (props): ClusterProps => ({ headcount: props.headcount, severity: props.severity }),
    reduce: (accumulated, props): void => {
      accumulated.headcount += props.headcount;
      accumulated.severity = Math.max(accumulated.severity, props.severity);
    },
  });

  const features: PointFeature<PointProps>[] = msg.points.map((p) => ({
    type: 'Feature',
    properties: { cameraId: p.id, headcount: p.headcount, severity: p.severity, status: p.status },
    geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
  }));
  index.load(features);

  const rawClusters = index.getClusters(msg.bbox, Math.round(msg.zoom));
  const out: OutputFeature[] = rawClusters.map((f) => {
    const lng = f.geometry.coordinates[0]!;
    const lat = f.geometry.coordinates[1]!;
    if (isClusterFeature(f)) {
      return {
        isCluster: true,
        lng,
        lat,
        headcount: f.properties.headcount,
        severity: f.properties.severity,
        count: f.properties.point_count,
        clusterId: f.properties.cluster_id,
      };
    }
    return {
      isCluster: false,
      lng,
      lat,
      headcount: f.properties.headcount,
      severity: f.properties.severity,
      count: 1,
      cameraId: f.properties.cameraId,
      status: f.properties.status,
    };
  });

  self.postMessage({ type: 'result', requestId: msg.requestId, features: out });
};

function isClusterFeature(
  f: ClusterFeature<ClusterProps> | PointFeature<PointProps>,
): f is ClusterFeature<ClusterProps> {
  return 'cluster' in f.properties && f.properties.cluster === true;
}
