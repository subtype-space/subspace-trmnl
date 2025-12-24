import { string } from "zod";

export type TrmnlMeta = {
  user?: { name?: string; time_zone_iana?: string; utc_offset?: number }
  device?: { friendly_id?: string; percent_charged?: number; wifi_strength?: number; height?: number; width?: number }
  system?: { timestamp_utc?: number }
  plugin_settings?: { instance_name?: string }
}

export type MetroMarkup = {
  instanceName: string
  displayLine: string
  status: string
  subtitleFinal: string
  dots: string
  totalIncidents: number
  utcOffset: number
}

export type MarkupVariant = 'full' | 'half_horizontal' | 'half_vertical' | 'quadrant'