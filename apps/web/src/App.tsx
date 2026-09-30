import { useState } from 'react';
import { TownCanvas } from './town/TownCanvas';
import { useTown } from './useTown';
import { BroadcastPanel } from './BroadcastPanel';
import { SensorPanel } from './SensorPanel';
import type { BroadcastResult } from '../../api/src/jev/types';

const places = {
  bakery: { title: 'Panadería', color: '#a86846' },
  fountain: { title: 'Fuente', color: '#739e98' },
  market: { title: 'Mercado', color: '#ae7951' },
  park: { title: 'Parque', color: '#77904c' },
};

const activities: Record<string, string> = {
  continue_current_activity: 'Seguir actividad',
  wandering: 'Paseo libre',
  idle: 'En pausa',
  go_to_bakery: 'Ir a panadería / pasear cerca',
  go_to_fountain: 'Ir a fuente / pasear cerca',
  go_to_market: 'Ir a mercado / pasear cerca',
  go_to_park: 'Ir a parque / pasear cerca',
  warn_others: 'Avisar a un vecino',
  flee: 'Alejarse / pasear cerca del POI',
};

export function App() {
  const { map, status, stats, agents, motion, sensors, sensorMarkers } = useTown();
  const [fps, setFps] = useState(0);
  const [selectedId, setSelectedId] = useState('');
  const [lastBroadcast, setLastBroadcast] = useState<{ map: typeof map; result: BroadcastResult } | null>(null);
  const lastResult = lastBroadcast?.map === map ? lastBroadcast.result : null;
  const selectedDecision = lastResult?.trace.decisions.find(decision => decision.agentId === selectedId);
  const probabilitySum = selectedDecision?.evaluation?.probabilities.reduce((sum, item) => sum + item.probability, 0);
  const selectedAgent = agents.find(agent => agent.id === selectedId);
  const target = selectedAgent?.targetPosition;
  const targetPoi = selectedAgent && (selectedAgent.currentAction.startsWith('go_to_') || selectedAgent.currentAction === 'flee')
    ? map?.pois.find(poi => poi.position.x === target?.x && poi.position.y === target?.y) : undefined;

  return (
    <main className="shell">
      <section className="map-viewport" aria-label="Simulación del pueblo">
        {map ? <TownCanvas map={map} motion={motion} sensorMarkers={sensorMarkers} onFps={setFps} /> : <div className="map-message">{status === 'offline' ? 'Esperando conexión con el pueblo…' : 'Preparando el pueblo…'}</div>}
      </section>

      <header className="topbar">
        <div className="brand panel">
          <span className="brand-mark" aria-hidden="true">J</span>
          <div><p className="eyebrow">UN PEQUEÑO MUNDO VIVO</p><h1>Jev Town<span>.</span></h1><p className="brand-description">La vida del pueblo, a su ritmo.</p></div>
        </div>
        <div className="town-stats panel">
          <div className="population"><strong>{stats.population || '—'}</strong><span>habitantes</span></div>
          <div className="district-count"><strong>5</strong><span>barrios</span></div>
          <div className="connection">
            <span className={`status ${status}`} role="status"><i />{status === 'live' ? 'En vivo' : status === 'offline' ? 'Reconectando' : 'Conectando'}</span>
            <div className="fps" aria-label="Fotogramas por segundo"><span className={fps >= 55 ? 'fps-good' : ''}>{fps || '—'}</span> FPS</div>
          </div>
        </div>
      </header>

      <div className="town-tools">
        <aside className="town-tools-column" aria-label="Sensores y habitantes">
          <SensorPanel sensors={sensors} status={status} />
          <details className="npc-panel panel">
            <summary>Habitantes</summary>
            <label htmlFor="npc-select">Consultar NPC</label>
            <select id="npc-select" value={selectedAgent?.id ?? ''} onChange={event => setSelectedId(event.target.value)} disabled={!agents.length}>
              <option value="">Selecciona un habitante</option>
              {agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name} · {agent.id}</option>)}
            </select>
            <p className="npc-note" role="status">{status === 'offline' ? 'Sin conexión: datos del último snapshot.'
              : status === 'connecting' ? 'Esperando datos del pueblo…' : 'Estado recibido en vivo.'}</p>
            {selectedAgent && <>
              <dl className="npc-fields">
                <dt>ID</dt><dd>{selectedAgent.id}</dd>
                <dt>Nombre</dt><dd>{selectedAgent.name}</dd>
                <dt>Ocupación</dt><dd>{selectedAgent.occupation}</dd>
                <dt>Personalidad</dt><dd>{selectedAgent.personality}</dd>
                <dt>Actividad actual</dt><dd>{activities[selectedAgent.currentAction] ?? selectedAgent.currentAction}</dd>
                <dt>Posición</dt><dd>({selectedAgent.position.x}, {selectedAgent.position.y})</dd>
                <dt>{targetPoi ? 'Ancla POI' : 'Objetivo registrado'}</dt>
                <dd>{target ? <>{targetPoi && `${places[targetPoi.id].title} · `}({target.x}, {target.y})</> : 'Sin objetivo registrado'}</dd>
              </dl>
              {targetPoi && <p className="npc-note">El ancla POI no es el siguiente paso de la ruta.</p>}
              <p className="npc-note npc-tick">Último snapshot · Tick {stats.tick}. Actividad actual, no última elección de Jev.</p>
              <details className="npc-evaluation" key={selectedAgent.id}>
                <summary>Última decisión Jev</summary>
                {lastResult && selectedDecision ? <>
                  <p className="npc-note">Último lote exitoso recibido en esta pestaña. Se borra al recargar o reconectar.</p>
                  <p className="npc-note npc-announcement">{lastResult.trace.broadcast}</p>
                  <p className="npc-note npc-tick">Lote {lastResult.trace.id} · Tick {lastResult.trace.snapshotTick} · {new Date(lastResult.trace.snapshotTime).toLocaleString()}</p>
                  <dl className="npc-fields">
                    <dt>Actividad al decidir</dt><dd>{activities[selectedDecision.activityBefore] ?? selectedDecision.activityBefore}</dd>
                    <dt>Elección devuelta</dt><dd>{activities[selectedDecision.optionId]}</dd>
                  </dl>
                  {selectedDecision.evaluation ? <>
                    <p className="npc-note">Confianza del modelo: {(selectedDecision.evaluation.confidence * 100).toFixed(1)}%</p>
                    {probabilitySum !== undefined && Math.abs(probabilitySum - 1) > 1e-6 && <p className="npc-note" role="status">Suma recibida: {Number((probabilitySum * 100).toFixed(6))}%. Valores del proveedor sin normalizar.</p>}
                    <ul className="decision-distribution npc-probabilities" aria-label="Probabilidades de la última decisión">
                      {selectedDecision.evaluation.probabilities.map(item => <li key={item.optionId} className={item.optionId === selectedDecision.optionId ? 'chosen-option' : undefined}>
                        <span>{activities[item.optionId]}{item.optionId === selectedDecision.optionId && <small>Elegida</small>}</span>
                        <div className="decision-track" aria-hidden="true"><i style={{ width: `${item.probability * 100}%` }} /></div>
                        <strong>{(item.probability * 100).toFixed(1)}%</strong>
                      </li>)}
                    </ul>
                    <p className="npc-note">Son valores del modelo, no una explicación de sus motivos. Jev no devuelve un porqué narrativo.</p>
                  </> : <p className="npc-note">{lastResult.mode === 'mock' ? 'Decisión simulada: sin probabilidades del proveedor.' : 'Sin probabilidades disponibles para esta decisión.'}</p>}
                </> : <p className="npc-note">Aún no hay una decisión recibida para este NPC en esta pestaña. Abrir este desplegable no consulta Jev.</p>}
              </details>
            </>}
          </details>
        </aside>
        <aside className="town-tools-column" aria-label="Mensajes al pueblo">
          <BroadcastPanel connected={status === 'live'} onResult={result => setLastBroadcast({ map, result })} />
        </aside>
      </div>

      <footer className="map-footer">
        <div className="places-panel panel">
          <p className="eyebrow">LUGARES DEL PUEBLO</p>
          <ul className="places">
            {map?.pois.map(poi => <li key={poi.id}>
              <i style={{ background: places[poi.id].color }} />
              <div><strong>{places[poi.id].title}</strong><span>{poi.id}</span></div>
            </li>)}
          </ul>
        </div>
        <div className="map-guide panel">
          <div><kbd>Arrastrar</kbd><span>Mover cámara</span><kbd>Rueda</kbd><span>Zoom</span></div>
          <p>40 × 40 tiles <i /> Tick {stats.tick} · 500 ms <i /> Decisiones en runtime</p>
        </div>
      </footer>
    </main>
  );
}
