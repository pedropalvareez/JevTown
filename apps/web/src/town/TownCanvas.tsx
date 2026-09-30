import { useEffect, useRef, useState } from 'react';
import type { TownMap } from '../../../api/src/simulation/types';
import type { SensorMarker } from '../../../api/src/sensors/virtual-sensors';
import type { MotionBuffer } from './motion';
import { createTownScene } from './scene';

export function TownCanvas({ map, motion, sensorMarkers, onFps }: { map: TownMap; motion: MotionBuffer; sensorMarkers: SensorMarker[]; onFps: (fps: number) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let stopped = false;
    let scene: Awaited<ReturnType<typeof createTownScene>> | undefined;
    setError(false);
    void createTownScene(host.current!, map, motion, sensorMarkers, onFps).then(created => {
      if (stopped) created.destroy();
      else scene = created;
    }).catch(() => {
      if (!stopped) setError(true);
    });
    return () => {
      stopped = true;
      scene?.destroy();
    };
  }, [map, motion, sensorMarkers, onFps]);

  return (
    <>
      <div className="town-canvas" ref={host} />
      {error && <div className="map-message" role="alert">No se pudo iniciar WebGL. Activa la aceleración gráfica del navegador y recarga.</div>}
    </>
  );
}
