import { useEffect, useRef, useState } from 'react';
import type { ServerMessage, Snapshot, TownMap } from '../../api/src/simulation/types';
import type { SensorMarker } from '../../api/src/sensors/virtual-sensors';
import { MotionBuffer } from './town/motion';

export function useTown() {
  const motion = useRef(new MotionBuffer());
  const [map, setMap] = useState<TownMap | null>(null);
  const [sensorMarkers, setSensorMarkers] = useState<SensorMarker[]>([]);
  const [status, setStatus] = useState<'connecting' | 'live' | 'offline'>('connecting');
  const [snapshot, setSnapshot] = useState<ServerMessage | null>(null);

  useEffect(() => {
    let stopped = false;
    let socket: WebSocket;
    let retry: ReturnType<typeof setTimeout> | undefined;

    function connect() {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(`${protocol}//${window.location.host}/api/ws`);
      socket.onmessage = event => {
        if (stopped) return;
        try {
          const message: ServerMessage = JSON.parse(event.data);
          const frame: Snapshot = { tick: message.tick, serverTime: message.serverTime, agents: message.agents };
          if (message.type === 'init') {
            motion.current.reset(frame, message.tickMs);
            setMap(message.map);
            setSensorMarkers(message.sensorMarkers);
          } else if (message.type === 'tick') {
            motion.current.push(frame);
          } else {
            return;
          }
          setSnapshot(message);
          setStatus('live');
        } catch {
          socket.close();
        }
      };
      socket.onerror = () => socket.close();
      socket.onclose = () => {
        if (stopped) return;
        setStatus('offline');
        retry = setTimeout(connect, 1000);
      };
    }

    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      socket.onclose = null;
      socket.onerror = null;
      socket.close();
    };
  }, []);

  return {
    map, status, sensorMarkers, sensors: snapshot?.sensors ?? null, motion: motion.current,
    agents: snapshot?.agents ?? [],
    stats: { population: snapshot?.agents.length ?? 0, tick: snapshot?.tick ?? 0 },
  };
}
