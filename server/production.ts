import {z} from 'zod';
import {PRODUCTION_KINDS,VIDEO_ENGINES,VOICE_ENGINES} from '../src/production.js';
export const productionSchema=z.object({kind:z.enum(PRODUCTION_KINDS),objective:z.string().max(2000),audience:z.string().max(500),tone:z.string().max(500),targetSeconds:z.number().int().min(1).max(86400),episodes:z.number().int().min(1).max(100),episodeSeconds:z.number().int().min(1).max(14400),videoEngine:z.enum(VIDEO_ENGINES),voiceEngine:z.enum(VOICE_ENGINES),notes:z.string().max(4000)}).strict();
