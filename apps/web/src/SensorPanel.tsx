import type { SensorBatch } from '../../api/src/sensors/iot-agent';

export function SensorPanel({ sensors, status }: { sensors: SensorBatch | null; status: 'connecting' | 'live' | 'offline' }) {
  const live = status === 'live' && sensors !== null;
  return (
    <details className="sensor-panel panel" open>
      <summary>Sensores{sensors && !live && <span className="sensor-stale">Datos antiguos</span>}</summary>
      <p className={`sensor-note${live ? '' : ' sensor-stale'}`} role="status">
        {live ? 'Personas detectadas · ocupación instantánea.' : sensors ? 'Sin conexión: lecturas antiguas del último snapshot.' : 'Esperando primera lectura del pueblo…'}
      </p>
      {sensors && <>
        <ul className="sensor-counts" aria-label="Personas detectadas por sensor">
          {sensors.entities.map((entity, index) => <li key={entity.id}>
            <span className="sensor-code">S{index + 1}</span><span>{entity.name.value}</span><strong>{entity.peopleCount.value}</strong>
          </li>)}
        </ul>
        <p className="sensor-note sensor-time">Tick {sensors.tick} · <time dateTime={new Date(sensors.serverTime).toISOString()}>{new Date(sensors.serverTime).toLocaleString()}</time></p>
      </>}
      <p className="sensor-note">Calles a ≤ 3 casillas Manhattan. Fuera de cobertura no cuenta; el total puede ser menor de 50.</p>
      <p className="sensor-note">Sensores → IoT Agent mock → broker mock. Solo memoria local; no es un broker FIWARE real.</p>
    </details>
  );
}
