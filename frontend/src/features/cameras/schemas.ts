import { z } from 'zod';

const rtspUrlPattern = /^rtsp:\/\/[^\s@/]+(:\d+)?\/.+$/i;

export const cameraFormSchema = z.object({
  name: z.string().min(2, 'Name is required').max(80),
  zoneId: z.string().min(1, 'Zone is required'),
  lat: z.coerce.number().min(-90, 'Latitude must be between -90 and 90').max(90).nullable(),
  lng: z.coerce.number().min(-180, 'Longitude must be between -180 and 180').max(180).nullable(),
  rtspUrl: z.string().regex(rtspUrlPattern, 'Must look like rtsp://host/path'),
  rtspUsername: z.string().max(120).optional(),
  rtspPassword: z.string().max(200).optional(),
  bearing: z.coerce.number().min(0).max(360),
  fovAngle: z.coerce.number().min(1).max(360),
  range: z.coerce.number().min(1).max(1000),
  tags: z.string().optional(),
});

export type CameraFormValues = z.infer<typeof cameraFormSchema>;
