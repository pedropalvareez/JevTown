import type { SensorReadings } from './virtual-sensors.js';

const context = {
  id: '@id',
  type: '@type',
  Property: 'https://uri.etsi.org/ngsi-ld/Property',
  DateTime: 'https://uri.etsi.org/ngsi-ld/DateTime',
  value: 'https://uri.etsi.org/ngsi-ld/hasValue',
  observedAt: { '@id': 'https://uri.etsi.org/ngsi-ld/observedAt', '@type': 'https://uri.etsi.org/ngsi-ld/DateTime' },
  CrowdFlowObserved: 'https://smartdatamodels.org/dataModel.Transportation/CrowdFlowObserved',
  peopleCount: 'https://smartdatamodels.org/dataModel.Transportation/peopleCount',
  dateObserved: 'https://smartdatamodels.org/dateObserved',
  name: 'https://smartdatamodels.org/name',
  description: 'http://purl.org/dc/terms/description',
} as const;

export interface CrowdFlowObserved {
  id: string;
  type: 'CrowdFlowObserved';
  name: { type: 'Property'; value: string };
  description: { type: 'Property'; value: string };
  peopleCount: { type: 'Property'; value: number; observedAt: string };
  dateObserved: { type: 'Property'; value: { '@type': 'DateTime'; '@value': string } };
  '@context': typeof context;
}

export interface SensorBatch {
  simulated: true;
  tick: number;
  serverTime: number;
  entities: CrowdFlowObserved[];
}

export function adaptSensorReadings(readings: SensorReadings): SensorBatch {
  const instant = new Date(readings.serverTime).toISOString();
  return {
    simulated: true,
    tick: readings.tick,
    serverTime: readings.serverTime,
    entities: readings.readings.map(reading => ({
      id: reading.id,
      type: 'CrowdFlowObserved',
      name: { type: 'Property', value: reading.name },
      description: { type: 'Property', value: 'SIMULADO: personas presentes en calles dentro de 3 casillas Manhattan, en el instante observado.' },
      peopleCount: { type: 'Property', value: reading.peopleCount, observedAt: instant },
      dateObserved: { type: 'Property', value: { '@type': 'DateTime', '@value': instant } },
      '@context': context,
    })),
  };
}
