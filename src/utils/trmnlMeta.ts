import type { TrmnlMeta } from '../types/trmnl/types.js'
import { logger } from './logger.js'

export function parseTrmnlMeta(raw: unknown): TrmnlMeta | null {
  if (raw && typeof raw === 'object') return raw as TrmnlMeta
  if (typeof raw === 'string' && raw.trim()) {
    try {
      return JSON.parse(raw) as TrmnlMeta
    } catch {
      logger.warn('[TRMNL] Failed to parse trmnl metadata JSON')
    }
  }
  return null
}
