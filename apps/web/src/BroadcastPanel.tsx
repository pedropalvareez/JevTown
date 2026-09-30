import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { BroadcastResult, DecisionAction, JevStatus } from '../../api/src/jev/types';

const labels: Record<DecisionAction, string> = {
  continue_current_activity: 'Seguir actividad',
  go_to_bakery: 'Ir a panadería',
  go_to_fountain: 'Ir a fuente',
  go_to_market: 'Ir a mercado',
  go_to_park: 'Ir a parque',
  warn_others: 'Avisar a un vecino',
  flee: 'Alejarse',
};

export function BroadcastPanel({ connected, onResult }: { connected: boolean; onResult: (result: BroadcastResult) => void }) {
  const [text, setText] = useState('Liquidación en la panadería, todo debe irse.');
  const [jev, setJev] = useState<JevStatus | null>(null);
  const [processing, setProcessing] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<BroadcastResult | null>(null);
  const pending = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!connected) { setJev(null); return; }
    const controller = new AbortController();
    void fetch('/api/jev', { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error();
      const status: JevStatus = await response.json();
      if (!controller.signal.aborted) { setJev(status); setError(''); }
    }).catch(() => {
      if (!controller.signal.aborted) setError('No se pudo consultar el modo Jev. Recarga para reintentar.');
    });
    return () => controller.abort();
  }, [connected]);

  useEffect(() => () => pending.current?.abort(), []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || !connected || !jev?.available || !text.trim()) return;
    const controller = new AbortController();
    pending.current = controller;
    setProcessing(true);
    setError('');
    setResult(null);
    try {
      const response = await fetch('/api/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ broadcast: text.trim() }),
        signal: controller.signal,
      });
      const data = await response.json();
      if (!controller.signal.aborted) {
        if (response.ok) { setResult(data); onResult(data); }
        else setError(typeof data.error === 'string' ? data.error : 'No se pudo completar el broadcast.');
      }
    } catch {
      if (!controller.signal.aborted) setError('No se pudo confirmar el resultado. El servidor puede seguir procesando; espera antes de reintentar.');
    } finally {
      if (!controller.signal.aborted) setProcessing(false);
      pending.current = null;
    }
  }

  async function resumeWandering() {
    if (resuming || processing || !connected) return;
    setResuming(true);
    setError('');
    try {
      const response = await fetch('/api/wander', { method: 'POST' });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(typeof data.error === 'string' ? data.error : 'No se pudo reanudar el paseo libre.');
      }
    } catch {
      setError('No se pudo reanudar el paseo libre. Comprueba la conexión.');
    } finally {
      setResuming(false);
    }
  }

  return (
    <section className="broadcast-panel panel" aria-labelledby="broadcast-title">
      <div className="broadcast-heading">
        <h2 id="broadcast-title">Un mensaje al pueblo</h2>
        <span className="jev-mode">{jev ? (jev.mode === 'http' ? 'JEV REAL' : 'MOCK') : 'Conectando'}</span>
      </div>
      <p className="broadcast-note">{!jev ? 'Consultando modo de decisiones…' : jev.mode === 'mock'
        ? 'Decisiones simuladas; no consume créditos Jev.'
        : jev.available ? 'Jev real: cada Broadcast consume API. Sin fallback a mock.'
          : 'Jev HTTP no disponible: configura JEV_API_KEY en el backend.'}</p>
      <form onSubmit={submit} aria-busy={processing}>
        <label htmlFor="broadcast-text">¿Qué ocurre en el pueblo?</label>
        <textarea id="broadcast-text" value={text} onChange={event => setText(event.target.value)} maxLength={2000} rows={3} disabled={processing} />
        <div className="broadcast-controls">
          <span>50 habitantes · un único batch</span>
          <div className="broadcast-buttons">
            <button type="button" className="secondary" onClick={resumeWandering} disabled={!connected || processing || resuming} title="Todos vuelven a pasear libremente. No consulta Jev.">Paseo libre</button>
            <button type="submit" disabled={!connected || !jev?.available || processing || !text.trim()}>{processing ? 'Procesando…' : 'Broadcast'}</button>
          </div>
        </div>
      </form>
      {processing && <p className="broadcast-note" role="status">Decidiendo… El pueblo sigue en movimiento.</p>}
      {error && <p className="broadcast-error" role="alert">{error}</p>}
      {result && <div className="broadcast-result" role="status">
        <div className="broadcast-summary"><strong>{result.total} decisiones</strong><span>Batch: {result.latencyMs} ms</span></div>
        <ul className="decision-distribution">
          {result.distribution.map(item => <li key={item.optionId}>
            <span>{labels[item.optionId]}</span>
            <div className="decision-track" aria-hidden="true"><i style={{ width: `${item.count / result.total * 100}%` }} /></div>
            <strong>{item.count}</strong>
          </li>)}
        </ul>
      </div>}
    </section>
  );
}
