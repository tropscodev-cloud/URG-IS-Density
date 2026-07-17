import { useEffect } from 'react';
import { MapboxOverlay, type MapboxOverlayProps } from '@deck.gl/mapbox';
import { useControl } from 'react-map-gl/maplibre';

interface Props extends MapboxOverlayProps {
  onReady?: (overlay: MapboxOverlay) => void;
}

/** Wires a deck.gl interleaved overlay into react-map-gl/maplibre's control lifecycle. */
export function DeckOverlay({ onReady, ...props }: Props): null {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay(props));
  overlay.setProps(props);
  useEffect(() => {
    onReady?.(overlay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlay]);
  return null;
}
