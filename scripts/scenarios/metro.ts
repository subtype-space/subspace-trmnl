// DC Metro preview scenarios.
import type { MetroMarkup } from '../../src/types/wmata/types.js'

const base: MetroMarkup = {
  instanceName: 'Is my metro commute screwed?',
  displayLine: 'RD',
  status: 'GOOD',
  subtitleFinal: 'No delays',
  selectedLines: ['RD', 'OR', 'SV', 'BL', 'YL', 'GR'],
  disruption: {},
  alert: {},
  totalIncidents: 0,
  utcOffset: -4,
}

export type Scenario = { title: string; markup: MetroMarkup }
export const scenarios: Scenario[] = [
  { title: 'All clear', markup: { ...base } },
  {
    title: 'Minor alert on RD (warn only)',
    markup: { ...base, status: 'MEH', subtitleFinal: 'Minor delays • 1 alert(s)', alert: { RD: 1 }, totalIncidents: 1 },
  },
  {
    title: 'Disruption on RD (bad)',
    markup: {
      ...base,
      status: 'SCREWED',
      subtitleFinal: 'Delays likely',
      disruption: { RD: 1 },
      totalIncidents: 2,
    },
  },
  {
    title: 'System-wide (4 incidents, "EH. MAYBE.")',
    markup: { ...base, status: 'EH. MAYBE.', subtitleFinal: 'Delays may impact transfers', alert: { RD: 1, OR: 1 }, disruption: { BL: 1 }, totalIncidents: 4 },
  },
  {
    title: 'System-wide (5+ incidents, "SO SCREWED")',
    markup: { ...base, status: 'SO SCREWED', subtitleFinal: 'Delays may impact transfers', alert: { RD: 1, OR: 1 }, disruption: { BL: 1, YL: 1, GR: 1 }, totalIncidents: 5 },
  },
  {
    title: 'Emergency',
    markup: { ...base, status: "YOU'RE SO SCREWED.", subtitleFinal: 'Emergency on the line', disruption: { RD: 1 }, totalIncidents: 1 },
  },
]
