/** These are creative directions, not promises of optical or camera simulation. */
export const CINEMA_VALUES = {
  director: ['hitchcock', 'kurosawa', 'ozu', 'kubrick', 'tarkovsky', 'varda', 'wong-kar-wai', 'wes-anderson', 'sofia-coppola', 'chloe-zhao', 'fincher', 'almodovar'],
  takeType: ['establishing', 'master', 'sequence', 'dialogue', 'pov', 'reaction', 'insert', 'cutaway', 'reveal', 'product-hero'],
  cameraStyle: ['digital-clean', 'film-35', 'film-16', 'large-format'],
  framing: ['extreme-wide', 'wide', 'medium', 'close-up', 'extreme-close-up', 'over-shoulder', 'two-shot'],
  angle: ['eye-level', 'low', 'high', 'overhead', 'dutch'],
  lens: ['18mm', '24mm', '35mm', '50mm', '85mm', '135mm', 'anamorphic'],
  aperture: ['shallow', 'balanced', 'deep'],
  fStop: ['f1.4', 'f2.8', 'f5.6', 'f11'],
  movement: ['locked', 'dolly-in', 'dolly-out', 'pan-left', 'pan-right', 'tracking', 'orbit', 'crane-up', 'handheld', 'tilt-up', 'tilt-down', 'crane-down', 'follow', 'lead', 'zoom-in', 'zoom-out', 'dolly-zoom', 'whip-pan', 'lateral-reveal', 'pedestal-up', 'pedestal-down'],
  pace: ['still', 'gentle', 'measured', 'energetic'],
  lighting: ['natural', 'window', 'soft-studio', 'low-key', 'backlit', 'golden-hour', 'neon'],
  palette: ['natural', 'warm-film', 'cool', 'muted', 'monochrome', 'vibrant'],
  filmFormat: ['super8', '16mm', 'super16', '35mm', '65mm'],
  filmStock: ['daylight-fine', 'tungsten-fine', 'tungsten-fast', 'reversal-color', 'bw-negative', 'bw-reversal', 'bleach-bypass', 'cross-process'],
  lensFamily: ['spherical-modern', 'vintage', 'anamorphic', 'macro', 'probe', 'tilt-shift', 'fisheye', 'zoom'],
  cameraBody: ['cinema-digital', 'cinema-large', 'mirrorless', 'film-motion', 'broadcast', 'dv-tape', 'action', 'smartphone'],
  era: ['prehistory', 'antiquity', 'medieval', 'early-modern', 'nineteenth', '1900s', '1910s', '1920s', '1930s', '1940s', '1950s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s', 'contemporary', 'future', 'custom'],
} as const;
export type CinemaFieldKey = keyof typeof CINEMA_VALUES;
export const HISTORICAL_CONTEXT_LIMITS = { year: 80, location: 160, notes: 1200 } as const;
export const HISTORICAL_MODES = ['faithful', 'stylized', 'alternate'] as const;
export type HistoricalContext = { year?: string; location?: string; notes?: string; mode?: typeof HISTORICAL_MODES[number] };
export type Cinematography = { [K in CinemaFieldKey]?: typeof CINEMA_VALUES[K][number] } & { historicalContext?: HistoricalContext };
type CinemaField = { [K in CinemaFieldKey]: { key: K; label: string; options: { value: NonNullable<Cinematography[K]>; label: string; prompt: string }[] } }[CinemaFieldKey];

export const CINEMA_FIELDS: CinemaField[] = [
  { key: 'director', label: 'Referencia de dirección', options: [
    { value: 'hitchcock', label: 'Alfred Hitchcock', prompt: 'An interpretive directing reference to Alfred Hitchcock: organize attention around what the character knows and what remains unseen; make an already-scripted detail carry suspense.' },
    { value: 'kurosawa', label: 'Akira Kurosawa', prompt: 'An interpretive directing reference to Akira Kurosawa: give the scripted action a readable cause and consequence, with clear relationships between characters and their environment.' },
    { value: 'ozu', label: 'Yasujirō Ozu', prompt: 'An interpretive directing reference to Yasujirō Ozu: attend to everyday gestures, the spaces between people and the emotional weight of a quiet interaction.' },
    { value: 'kubrick', label: 'Stanley Kubrick', prompt: 'An interpretive directing reference to Stanley Kubrick: emphasize exact spatial relationships, deliberate blocking and tension between a character and the surrounding architecture.' },
    { value: 'tarkovsky', label: 'Andréi Tarkovski', prompt: 'An interpretive directing reference to Andrei Tarkovsky: let the scripted action register through duration, material surfaces and a contemplative relation to the environment, within the requested clip length.' },
    { value: 'varda', label: 'Agnès Varda', prompt: 'An interpretive directing reference to Agnes Varda: observe everyday detail with curiosity, connect the individual to their surroundings and allow a modest visual discovery within the scripted action.' },
    { value: 'wong-kar-wai', label: 'Wong Kar-wai', prompt: 'An interpretive directing reference to Wong Kar-wai: emphasize emotional distance, glances and a sense of separation within a shared space, without changing the scripted relationship.' },
    { value: 'wes-anderson', label: 'Wes Anderson', prompt: 'An interpretive directing reference to Wes Anderson: use deliberate staging, readable spatial relationships and carefully timed small gestures, retaining the script\u2019s emotional intention.' },
    { value: 'sofia-coppola', label: 'Sofia Coppola', prompt: 'An interpretive directing reference to Sofia Coppola: emphasize interior feeling, quiet observation and the character\u2019s relation to an enclosing social or architectural space.' },
    { value: 'chloe-zhao', label: 'Chloé Zhao', prompt: 'An interpretive directing reference to Chloe Zhao: foreground attentive observation of the person and their lived environment, allowing an unforced everyday gesture already present in the script.' },
    { value: 'fincher', label: 'David Fincher', prompt: 'An interpretive directing reference to David Fincher: prioritize precise staging, legible narrative information and restrained control of where attention moves within the image.' },
    { value: 'almodovar', label: 'Pedro Almodóvar', prompt: 'An interpretive directing reference to Pedro Almodovar: give emotional relationships and meaningful existing domestic details clear expressive weight, without adding narrative events or changing identities.' },
  ] },
  { key: 'takeType', label: 'Tipo de toma', options: [
    { value: 'establishing', label: 'Presentación del lugar', prompt: 'An establishing narrative function: make the scene location and the subject\u2019s relation to it understandable within the explicitly selected framing; do not force a wide shot.' },
    { value: 'master', label: 'Plano maestro', prompt: 'A master-shot narrative function: preserve readable geography and continuity of the scripted action in one coverage take, within the selected framing and clip duration; do not add characters or cuts.' },
    { value: 'sequence', label: 'Plano secuencia', prompt: 'One uninterrupted sequence take, with no internal cuts; stage a single coherent scripted action within the requested clip duration and chosen camera movement. Do not lengthen the clip or invent additional events.' },
    { value: 'dialogue', label: 'Diálogo', prompt: 'Dialogue coverage: preserve the assigned speaker, eyeline, established screen direction and timing of the supplied dialogue; respect the selected framing and do not invent words, voices or additional speakers.' },
    { value: 'pov', label: 'Punto de vista · POV', prompt: 'A subjective point-of-view take from the designated character\u2019s visual position, showing the scripted object of their attention while maintaining established screen direction; do not invent a new observer or identity.' },
    { value: 'reaction', label: 'Reacción', prompt: 'A reaction take: show the existing character\u2019s scripted response through a readable gesture or expression, maintaining their identity, eyeline and the explicit framing without inventing dialogue.' },
    { value: 'insert', label: 'Inserto de detalle', prompt: 'An insert narrative function: direct attention to an existing story-relevant object or gesture within the selected framing; preserve the object\u2019s exact continuity and do not add labels, text or props.' },
    { value: 'cutaway', label: 'Recurso del entorno', prompt: 'A cutaway resource take: observe an existing environmental detail relevant to the script, maintaining location, period and object continuity. Produce one take, not an automatic edit or a new event.' },
    { value: 'reveal', label: 'Revelación', prompt: 'A reveal narrative function: move attention from an initially withheld scripted detail to a clear final understanding using the selected camera movement or subject action; do not invent hidden characters, objects or events.' },
    { value: 'product-hero', label: 'Objeto protagonista', prompt: 'A product-hero narrative function: make the assigned existing object legible in shape, material and relevant detail; preserve its exact design, colors and markings without inventing logos or changing the selected framing.' },
  ] },
  { key: 'cameraStyle', label: 'Carácter de cámara', options: [
    { value: 'digital-clean', label: 'Digital limpio', prompt: 'A clean contemporary digital-cinema aesthetic with fine detail and restrained texture; retain natural facial features.' },
    { value: 'film-35', label: 'Película de 35 mm', prompt: 'A 35 mm photochemical-film-inspired aesthetic with fine organic grain and gentle highlight rolloff; retain facial and costume details.' },
    { value: 'film-16', label: 'Película de 16 mm', prompt: 'A 16 mm film-inspired aesthetic with visible but restrained grain and tactile texture; preserve recognizable faces, costume and objects.' },
    { value: 'large-format', label: 'Gran formato', prompt: 'A large-format cinema-inspired aesthetic with fine tonal gradation and clear environmental detail, without changing the requested framing or subject identity.' },
  ] },
  { key: 'framing', label: 'Encuadre', options: [
    { value: 'extreme-wide', label: 'Gran plano general', prompt: 'Extreme wide establishing shot; the environment dominates the composition.' },
    { value: 'wide', label: 'Plano general', prompt: 'Wide shot, showing the full subject and its surroundings.' },
    { value: 'medium', label: 'Plano medio', prompt: 'Medium shot, framing the subject from the waist up.' },
    { value: 'close-up', label: 'Primer plano', prompt: 'Close-up emphasizing the subject’s expression and recognizable features.' },
    { value: 'extreme-close-up', label: 'Plano detalle', prompt: 'Extreme close-up concentrating on a meaningful small detail.' },
    { value: 'over-shoulder', label: 'Sobre el hombro', prompt: 'Over-the-shoulder composition with clear spatial relation between subjects.' },
    { value: 'two-shot', label: 'Plano de dos', prompt: 'Two-shot keeping both characters clearly visible in the same frame.' },
  ] },
  { key: 'angle', label: 'Ángulo', options: [
    { value: 'eye-level', label: 'A la altura de los ojos', prompt: 'Camera at the subject’s eye level.' },
    { value: 'low', label: 'Contrapicado', prompt: 'Low camera angle, looking upward at the subject.' },
    { value: 'high', label: 'Picado', prompt: 'High camera angle, looking down at the subject.' },
    { value: 'overhead', label: 'Cenital', prompt: 'Overhead camera looking straight down.' },
    { value: 'dutch', label: 'Inclinado', prompt: 'A deliberate, restrained Dutch camera angle.' },
  ] },
  { key: 'lens', label: 'Óptica sugerida', options: [
    { value: '18mm', label: '18 mm · muy angular', prompt: 'An 18 mm ultra-wide lens aesthetic, emphasizing depth and surroundings.' },
    { value: '24mm', label: '24 mm · angular', prompt: 'A 24 mm wide-angle lens aesthetic with a strong sense of space.' },
    { value: '35mm', label: '35 mm · narrativo', prompt: 'A 35 mm lens aesthetic with natural environmental perspective.' },
    { value: '50mm', label: '50 mm · natural', prompt: 'A 50 mm normal-lens aesthetic with natural proportions.' },
    { value: '85mm', label: '85 mm · retrato', prompt: 'An 85 mm portrait-lens aesthetic with restrained perspective compression.' },
    { value: '135mm', label: '135 mm · teleobjetivo', prompt: 'A 135 mm telephoto-lens aesthetic with compressed background perspective.' },
    { value: 'anamorphic', label: 'Anamórfica', prompt: 'An anamorphic cinema-lens aesthetic with subtle oval bokeh and restrained horizontal flares.' },
  ] },
  { key: 'aperture', label: 'Profundidad de campo', options: [
    { value: 'shallow', label: 'Fondo desenfocado', prompt: 'Shallow depth of field; keep the principal subject sharp against a softly blurred background.' },
    { value: 'balanced', label: 'Equilibrada', prompt: 'Moderate depth of field; subject and immediate surroundings remain legible.' },
    { value: 'deep', label: 'Todo en foco', prompt: 'Deep focus keeping foreground and background details readable.' },
  ] },
  { key: 'fStop', label: 'Apertura sugerida', options: [
    { value: 'f1.4', label: 'f/1.4 · muy abierta', prompt: 'An f/1.4-inspired wide-aperture aesthetic with strong background separation; keep both eyes and identity-defining features sharp.' },
    { value: 'f2.8', label: 'f/2.8 · abierta', prompt: 'An f/2.8-inspired aperture aesthetic, with soft background separation and a readable principal subject.' },
    { value: 'f5.6', label: 'f/5.6 · intermedia', prompt: 'An f/5.6-inspired aperture aesthetic balancing subject detail and readable nearby surroundings.' },
    { value: 'f11', label: 'f/11 · cerrada', prompt: 'An f/11-inspired deep-focus aesthetic, retaining readable foreground and background details.' },
  ] },
  { key: 'movement', label: 'Movimiento de cámara', options: [
    { value: 'locked', label: 'Cámara fija', prompt: 'Locked-off tripod camera, without camera translation or rotation.' },
    { value: 'dolly-in', label: 'Acercamiento', prompt: 'A smooth physical dolly move toward the subject.' },
    { value: 'dolly-out', label: 'Alejamiento', prompt: 'A smooth physical dolly move away from the subject.' },
    { value: 'pan-left', label: 'Paneo a la izquierda', prompt: 'A controlled camera pan to the left from a fixed position.' },
    { value: 'pan-right', label: 'Paneo a la derecha', prompt: 'A controlled camera pan to the right from a fixed position.' },
    { value: 'tracking', label: 'Seguimiento', prompt: 'A smooth lateral tracking shot following the subject’s movement.' },
    { value: 'orbit', label: 'Órbita', prompt: 'A continuous camera arc around the subject while maintaining its recognizable form.' },
    { value: 'crane-up', label: 'Grúa ascendente', prompt: 'A smooth ascending crane move revealing more of the surroundings.' },
    { value: 'handheld', label: 'Cámara en mano', prompt: 'Subtle, intentional handheld camera movement with readable framing.' },
    { value: 'tilt-up', label: 'Inclinación hacia arriba', prompt: 'Tilt the camera upward around a fixed camera position; rotate its viewing direction vertically without raising or translating the camera.' },
    { value: 'tilt-down', label: 'Inclinación hacia abajo', prompt: 'Tilt the camera downward around a fixed camera position; rotate its viewing direction vertically without lowering or translating the camera.' },
    { value: 'crane-down', label: 'Grúa descendente', prompt: 'A smooth descending crane move along a gentle spatial arc toward the scripted subject; maintain readable geography and subject identity.' },
    { value: 'follow', label: 'Seguimiento desde atrás', prompt: 'Translate the camera behind the moving subject, following the same forward route at a stable distance; preserve the established direction of travel and surroundings.' },
    { value: 'lead', label: 'Acompañamiento frontal', prompt: 'Move the camera backward ahead of the advancing subject, facing the subject at a stable distance; preserve the established route, recognizable face and direction of travel.' },
    { value: 'zoom-in', label: 'Zoom de acercamiento', prompt: 'Keep the camera position fixed and smoothly increase focal length to tighten the view, using the selected focal-length aesthetic as the starting point; do not introduce physical dolly motion.' },
    { value: 'zoom-out', label: 'Zoom de alejamiento', prompt: 'Keep the camera position fixed and smoothly decrease focal length to widen the view, using the selected focal-length aesthetic as the starting point; do not introduce physical dolly motion.' },
    { value: 'dolly-zoom', label: 'Dolly zoom', prompt: 'Move the camera physically toward the subject while smoothly widening the lens view to keep the subject approximately the same size and change the apparent background relationship; preserve facial proportions and start from the selected framing.' },
    { value: 'whip-pan', label: 'Barrido rápido', prompt: 'A single fast horizontal whip pan from a fixed camera position between two scripted points, with a readable settled beginning and ending; allow brief directional blur only during the pan, with no cut or invented subject.' },
    { value: 'lateral-reveal', label: 'Revelación lateral', prompt: 'Translate the camera laterally past an existing foreground edge to reveal the scripted subject; use actual spatial parallax, no cut, and do not invent an obstruction or new object.' },
    { value: 'pedestal-up', label: 'Elevación vertical', prompt: 'Translate the entire camera straight upward while keeping its viewing direction level; no vertical tilt, arc or zoom.' },
    { value: 'pedestal-down', label: 'Descenso vertical', prompt: 'Translate the entire camera straight downward while keeping its viewing direction level; no vertical tilt, arc or zoom.' },
  ] },
  { key: 'pace', label: 'Ritmo del plano', options: [
    { value: 'still', label: 'Contemplativo', prompt: 'A contemplative pace, with only minimal subject motion.' },
    { value: 'gentle', label: 'Suave', prompt: 'Gentle, unhurried action and motion.' },
    { value: 'measured', label: 'Medido', prompt: 'A deliberate, measured pace with clearly readable action.' },
    { value: 'energetic', label: 'Enérgico', prompt: 'Energetic action with coherent motion and stable subject identity.' },
  ] },
  { key: 'lighting', label: 'Iluminación', options: [
    { value: 'natural', label: 'Luz natural', prompt: 'Plausible natural lighting consistent with the scene.' },
    { value: 'window', label: 'Luz de ventana', prompt: 'Soft directional window light with gradual shadow falloff.' },
    { value: 'soft-studio', label: 'Estudio suave', prompt: 'Soft studio lighting with controlled reflections and clear product or subject detail.' },
    { value: 'low-key', label: 'Claroscuro', prompt: 'Low-key cinematic lighting with sculpted shadows and preserved facial detail.' },
    { value: 'backlit', label: 'Contraluz', prompt: 'Backlighting that outlines the subject while preserving readable identity details.' },
    { value: 'golden-hour', label: 'Hora dorada', prompt: 'Warm low-angle golden-hour light with soft, long shadows.' },
    { value: 'neon', label: 'Neón', prompt: 'Motivated neon illumination and restrained colored reflections.' },
  ] },
  { key: 'palette', label: 'Paleta', options: [
    { value: 'natural', label: 'Natural', prompt: 'Natural color rendering and believable skin tones.' },
    { value: 'warm-film', label: 'Película cálida', prompt: 'A warm photochemical film color palette with restrained saturation.' },
    { value: 'cool', label: 'Fría', prompt: 'A cool color palette, while keeping skin tones believable.' },
    { value: 'muted', label: 'Desaturada', prompt: 'A muted, gently desaturated cinematic color palette.' },
    { value: 'monochrome', label: 'Blanco y negro', prompt: 'Black-and-white cinematography with rich tonal separation.' },
    { value: 'vibrant', label: 'Vibrante', prompt: 'Vibrant but controlled colors with preserved highlight and shadow detail.' },
  ] },
  { key: 'filmFormat', label: 'Formato de película', options: [
    { value: 'super8', label: 'Super 8', prompt: 'A Super 8-inspired small-gauge film texture with pronounced organic grain and intimate home-movie character, without adding frame borders or altering the requested aspect ratio.' },
    { value: '16mm', label: '16 mm', prompt: 'A standard 16 mm-inspired film texture with visible organic grain and tactile documentary character; retain facial and costume details without changing aspect ratio.' },
    { value: 'super16', label: 'Super 16', prompt: 'A Super 16-inspired film texture with fine visible grain and a tactile independent-cinema character; keep the chosen framing and output aspect ratio.' },
    { value: '35mm', label: '35 mm', prompt: 'A 35 mm-inspired film format with fine organic grain, rich tonal transitions and readable facial detail; preserve the chosen aspect ratio.' },
    { value: '65mm', label: '65 mm · gran formato', prompt: 'A 65 mm large-format-film-inspired aesthetic with restrained fine grain and subtle tonal detail; preserve the requested composition and aspect ratio.' },
  ] },
  { key: 'filmStock', label: 'Emulsión y revelado', options: [
    { value: 'daylight-fine', label: 'Negativo diurno · 50D', prompt: 'An artistic 50D-inspired daylight-balanced color-negative film finish with fine grain, natural skin tones and gently rolled highlights; this is stock-inspired creative direction, not a calibrated emulation.' },
    { value: 'tungsten-fine', label: 'Negativo tungsteno · 200T', prompt: 'An artistic 200T-inspired fine-grain tungsten-balanced color-negative film finish with rich midtones and controlled warm practical lights; retain the established lighting and identity, without claiming calibrated stock emulation.' },
    { value: 'tungsten-fast', label: 'Negativo tungsteno · 500T', prompt: 'An artistic 500T-inspired high-speed tungsten-balanced color-negative film finish with more visible organic grain and soft luminous highlights; preserve eyes, facial features and costume detail, without claiming calibrated stock emulation.' },
    { value: 'reversal-color', label: 'Reversible color', prompt: 'A color-reversal-film-inspired finish with clean saturated colors, defined contrast and detailed highlights; preserve recognizable skin and objects.' },
    { value: 'bw-negative', label: 'Negativo blanco y negro', prompt: 'A black-and-white negative-film-inspired finish with rich grayscale separation, gentle highlights and fine organic grain.' },
    { value: 'bw-reversal', label: 'Reversible blanco y negro', prompt: 'A black-and-white reversal-film-inspired finish with deep blacks, crisp tonal separation and pronounced but controlled contrast.' },
    { value: 'bleach-bypass', label: 'Retención de plata', prompt: 'An artistic bleach-bypass-inspired finish with muted color, pronounced contrast and tactile silver-like texture, retaining shadow detail and subject identity.' },
    { value: 'cross-process', label: 'Proceso cruzado', prompt: 'An artistic cross-process-inspired finish with restrained color shifts and expressive contrast; keep recognizable skin, costume and object colors legible.' },
  ] },
  { key: 'lensFamily', label: 'Tipo de lente', options: [
    { value: 'spherical-modern', label: 'Esférico moderno', prompt: 'A modern spherical-lens aesthetic with neutral rendering, clear detail and controlled aberrations; retain the selected focal-length perspective.' },
    { value: 'vintage', label: 'Esférico vintage', prompt: 'A vintage spherical-lens-inspired aesthetic with gentle highlight bloom, restrained edge softness and subtle character, keeping the face sharp and recognizable.' },
    { value: 'anamorphic', label: 'Anamórfico', prompt: 'An anamorphic-lens-inspired aesthetic with subtle oval bokeh and restrained horizontal flares; keep subject proportions and the selected output aspect ratio unchanged.' },
    { value: 'macro', label: 'Macro', prompt: 'A macro-lens-inspired close-detail aesthetic emphasizing small surfaces and texture; honor the selected shot size and preserve identity-defining features.' },
    { value: 'probe', label: 'Sonda', prompt: 'A probe-lens-inspired close perspective with strong near-to-far spatial depth and a readable surrounding environment; do not invent a camera move.' },
    { value: 'tilt-shift', label: 'Descentrable · tilt-shift', prompt: 'A tilt-shift-lens-inspired selective focus plane and controlled perspective; apply the effect to the environment without distorting faces or changing the requested framing.' },
    { value: 'fisheye', label: 'Ojo de pez', prompt: 'A fisheye-lens-inspired very wide field with deliberate curved environmental lines; keep the principal face near the optical center and recognizable.' },
    { value: 'zoom', label: 'Zoom cinematográfico', prompt: 'A cinematic zoom-lens rendering at the selected focal-length perspective; do not introduce a zoom move unless explicitly directed.' },
  ] },
  { key: 'cameraBody', label: 'Tipo de cámara', options: [
    { value: 'cinema-digital', label: 'Cine digital', prompt: 'A professional digital-cinema acquisition aesthetic with controlled highlight detail and stable natural color; any selected film finish is an additional artistic treatment.' },
    { value: 'cinema-large', label: 'Cine digital · gran sensor', prompt: 'A large-sensor digital-cinema-inspired acquisition aesthetic with fine tonal detail and clean separation; respect the selected focal length, depth of field and any artistic film finish.' },
    { value: 'mirrorless', label: 'Mirrorless', prompt: 'A contemporary mirrorless-camera-inspired acquisition aesthetic with natural detail and accessible location-filmmaking character; do not add handheld motion unless selected.' },
    { value: 'film-motion', label: 'Cine fotoquímico', prompt: 'A photochemical motion-picture-camera-inspired acquisition aesthetic, using the explicitly selected film format and stock finish when present; preserve stable framing.' },
    { value: 'broadcast', label: 'Broadcast · televisión', prompt: 'A broadcast-camera-inspired acquisition aesthetic with direct, readable detail and controlled electronic texture; honor the explicitly selected depth of field and frame rate.' },
    { value: 'dv-tape', label: 'DV / MiniDV', prompt: 'An artistic DV or MiniDV home-video-inspired camera texture with restrained electronic color and tape-era character; do not change the output resolution, frame rate or aspect ratio, and do not add interlacing artifacts.' },
    { value: 'action', label: 'Cámara de acción', prompt: 'An action-camera-inspired compact acquisition aesthetic with clear environmental detail; do not invent movement, lens distortion or a new viewpoint beyond the explicit shot directions.' },
    { value: 'smartphone', label: 'Teléfono', prompt: 'A smartphone-camera-inspired acquisition aesthetic with crisp accessible everyday detail, keeping skin natural and respecting the selected framing, lens and movement.' },
  ] },
  { key: 'era', label: 'Época de la historia', options: [
    { value: 'prehistory', label: 'Prehistoria', prompt: 'A prehistoric story setting, interpreted for the specified place and creative brief rather than a single universal prehistoric culture.' },
    { value: 'antiquity', label: 'Antigüedad', prompt: 'An ancient-world story setting appropriate to the specified region and user-supplied period brief; do not assume a particular civilization.' },
    { value: 'medieval', label: 'Edad Media', prompt: 'A medieval-period story setting interpreted through the specified geography and creative brief, without assuming a universal European setting.' },
    { value: 'early-modern', label: 'Edad Moderna', prompt: 'An early-modern-period story setting grounded in the user-specified location and creative brief rather than a single global visual style.' },
    { value: 'nineteenth', label: 'Siglo XIX', prompt: 'A nineteenth-century story setting interpreted for the specified location and creative brief.' },
    { value: '1900s', label: 'Década de 1900', prompt: 'A 1900s story setting interpreted for the specified location and creative brief.' },
    { value: '1910s', label: 'Años 1910', prompt: 'A 1910s story setting interpreted for the specified location and creative brief; do not add conflict or political events unless the script requests them.' },
    { value: '1920s', label: 'Años 20', prompt: 'A 1920s story setting interpreted for the specified location and creative brief; avoid treating a single city or culture as universal.' },
    { value: '1930s', label: 'Años 30', prompt: 'A 1930s story setting interpreted for the specified location and creative brief; avoid imposing a single national style or historical event.' },
    { value: '1940s', label: 'Años 40', prompt: 'A 1940s story setting interpreted for the specified location and creative brief; do not add a war setting unless the script requests it.' },
    { value: '1950s', label: 'Años 50', prompt: 'A 1950s story setting interpreted for the specified location and creative brief.' },
    { value: '1960s', label: 'Años 60', prompt: 'A 1960s story setting interpreted for the specified location and creative brief.' },
    { value: '1970s', label: 'Años 70', prompt: 'A 1970s story setting interpreted for the specified location and creative brief.' },
    { value: '1980s', label: 'Años 80', prompt: 'A 1980s story setting interpreted for the specified location and creative brief; do not assume neon styling unless selected.' },
    { value: '1990s', label: 'Años 90', prompt: 'A 1990s story setting interpreted for the specified location and creative brief.' },
    { value: '2000s', label: 'Años 2000', prompt: 'A 2000s story setting interpreted for the specified location and creative brief.' },
    { value: '2010s', label: 'Años 2010', prompt: 'A 2010s story setting interpreted for the specified location and creative brief.' },
    { value: 'contemporary', label: 'Contemporánea', prompt: 'A contemporary story setting following the user-supplied place and creative brief.' },
    { value: 'future', label: 'Futuro', prompt: 'A fictional future story setting whose technology, places and culture follow the user-supplied creative brief.' },
    { value: 'custom', label: 'Época personalizada', prompt: 'A user-defined story period following the supplied year, place and creative brief.' },
  ] },
];

export const CINEMA_PRESETS: { id: string; label: string; description: string; settings: Cinematography }[] = [
  { id: 'intimate', label: 'Retrato íntimo', description: 'Acercarse a una mirada con luz suave y fondo desenfocado.', settings: { framing: 'close-up', angle: 'eye-level', lens: '85mm', aperture: 'shallow', movement: 'locked', pace: 'gentle', lighting: 'window', palette: 'natural' } },
  { id: 'classic-noir', label: 'Noir clásico', description: 'Claroscuro, sombras y una cámara que observa.', settings: { framing: 'medium', angle: 'low', lens: '50mm', aperture: 'balanced', movement: 'dolly-in', pace: 'measured', lighting: 'low-key', palette: 'monochrome' } },
  { id: 'arrival', label: 'Llegada al lugar', description: 'Revelar el espacio con amplitud y un movimiento pausado.', settings: { framing: 'wide', angle: 'eye-level', lens: '24mm', aperture: 'deep', movement: 'dolly-in', pace: 'gentle', lighting: 'natural', palette: 'warm-film' } },
  { id: 'product', label: 'Objeto protagonista', description: 'Volumen, materiales y reflejos legibles en una órbita suave.', settings: { framing: 'close-up', lens: '85mm', aperture: 'balanced', movement: 'orbit', pace: 'gentle', lighting: 'soft-studio', palette: 'natural' } },
  { id: 'documentary', label: 'Presencia documental', description: 'Perspectiva cercana, luz disponible y cámara en mano contenida.', settings: { framing: 'medium', angle: 'eye-level', lens: '35mm', aperture: 'balanced', movement: 'handheld', pace: 'measured', lighting: 'natural', palette: 'natural' } },
];

/** Only explicit non-human element types change the built-in anatomical cues.
 * Empty, mixed and custom casts retain their original direction and user text. */
function nonHumanCompositionPrompt(key: CinemaFieldKey, value: string): string | undefined {
  if (key === 'framing') return ({
    medium: 'Medium shot of the assigned object, product or place, with its main form and immediate surroundings clearly readable.',
    'close-up': 'Close-up emphasizing the assigned object, product or place\u2019s recognizable form, materials and surface details.',
    'over-shoulder': 'Use an existing foreground element to frame the assigned subject, keeping a clear spatial relation; do not add an observer or a person for this composition.',
    'two-shot': 'Two-subject composition using only elements already specified in the script, clearly visible together; do not invent characters to fill the frame.',
  } as Record<string, string>)[value];
  if (key === 'angle' && value === 'eye-level') return 'Level camera at the assigned subject\u2019s main height, without introducing a human observer.';
  return undefined;
}

export function buildCinematographyPrompt(scene: { camera?: string; cinematography?: Cinematography }, subjectRoles: readonly string[] = []): string {
  const settings = scene.cinematography;
  const onlyNonHumanSubjects = subjectRoles.length > 0 && subjectRoles.every(role => {
    // Retain legacy labels such as “Objeto de continuidad · prueba”. Other
    // free-form roles remain unknown; descriptions are not used to infer type.
    const type = role.split('·', 1)[0]!.trim().toLowerCase().replace(/ de continuidad$/, '');
    return ['objeto', 'producto', 'lugar'].includes(type);
  });
  const instructions = CINEMA_FIELDS.flatMap(field => {
    if (field.key === 'director') return buildDirectorPrompt(settings, scene.camera) ? [buildDirectorPrompt(settings, scene.camera)] : [];
    if (field.key === 'takeType') return buildTakeTypePrompt(settings) ? [buildTakeTypePrompt(settings)] : [];
    if (field.key === 'era') return buildHistoricalPrompt(settings) ? [buildHistoricalPrompt(settings)] : [];
    if (!cinemaFieldIsActive(settings, field.key)) return [];
    const option = field.options.find(option => option.value === settings?.[field.key]);
    return option ? [onlyNonHumanSubjects ? nonHumanCompositionPrompt(field.key, option.value) ?? option.prompt : option.prompt] : [];
  });
  if (!settings?.framing && !settings?.movement && scene.camera?.trim()) instructions.unshift(`Camera direction: ${scene.camera.trim()}`);
  return instructions.join('\n');
}

type DirectorCue = { unless: CinemaFieldKey[]; prompt: string };
/** Optional visual ideas are omitted, rather than contradicted, when a user makes an explicit choice. */
const DIRECTOR_CUES: Record<NonNullable<Cinematography['director']>, DirectorCue[]> = {
  hitchcock: [{ unless: ['framing', 'takeType'], prompt: 'Consider isolating an existing meaningful detail to guide suspense.' }],
  kurosawa: [{ unless: ['framing', 'aperture', 'fStop'], prompt: 'Consider layered blocking with readable foreground, middle ground and background.' }],
  ozu: [
    { unless: ['angle'], prompt: 'Consider a low, level camera viewpoint suited to the scene.' },
    { unless: ['movement'], prompt: 'Consider a patient locked camera.' },
  ],
  kubrick: [{ unless: ['framing', 'angle', 'takeType'], prompt: 'Consider a centered composition with strong geometric depth.' }],
  tarkovsky: [{ unless: ['pace'], prompt: 'Consider patient attention to the passage of time within the short take.' }],
  varda: [{ unless: ['framing', 'takeType'], prompt: 'Consider an environmental composition that gives an everyday detail as much care as the person.' }],
  'wong-kar-wai': [{ unless: ['framing', 'takeType'], prompt: 'Consider partially framed space or an existing reflection to suggest emotional separation; do not add props or reflective surfaces.' }],
  'wes-anderson': [
    { unless: ['framing', 'angle', 'takeType'], prompt: 'Consider frontal, balanced geometry with carefully arranged existing elements.' },
    { unless: ['palette', 'filmStock'], prompt: 'Consider a coordinated expressive color scheme while preserving established wardrobe and object colors.' },
  ],
  'sofia-coppola': [{ unless: ['pace'], prompt: 'Consider a gentle pause in which a small expression remains readable.' }],
  'chloe-zhao': [{ unless: ['lighting'], prompt: 'Consider available natural light appropriate to the established location and time.' }],
  fincher: [{ unless: ['movement'], prompt: 'Consider a controlled camera that moves only when motivated by the scripted action.' }],
  almodovar: [{ unless: ['palette', 'filmStock'], prompt: 'Consider expressive color relationships among existing elements, preserving the locked colors of wardrobe and objects.' }],
};

export function buildDirectorPrompt(settings?: Cinematography, legacyCamera?: string): string {
  const option = CINEMA_FIELDS.find(field => field.key === 'director')?.options.find(option => option.value === settings?.director);
  if (!option || !settings?.director) return '';
  const legacyDirectionActive = Boolean(legacyCamera?.trim() && !settings.framing && !settings.movement);
  const cues = DIRECTOR_CUES[settings.director].filter(cue => !cue.unless.some(key => Boolean(settings[key])) && !(legacyDirectionActive && cue.unless.some(key => key === 'framing' || key === 'angle' || key === 'movement')));
  return [
    option.prompt,
    ...cues.map(cue => cue.prompt),
    'This is a selective educational interpretation, not an exact reproduction of a director or any existing film frame. Explicit framing, angle, lens, focus, movement, pace, lighting, palette, film, camera and story-period choices take priority over this reference. Preserve the script and every locked character identity, face, voice, costume, reference and object; do not import a director\u2019s actors, locations, era or recurring props.',
  ].join('\n');
}

function subjectiveViewConflicts(settings?: Cinematography): boolean {
  return settings?.takeType === 'pov' && (settings.framing === 'over-shoulder' || settings.framing === 'two-shot' || settings.angle === 'overhead');
}

export function buildTakeTypePrompt(settings?: Cinematography): string {
  const option = CINEMA_FIELDS.find(field => field.key === 'takeType')?.options.find(option => option.value === settings?.takeType);
  if (!option) return '';
  if (subjectiveViewConflicts(settings)) return 'Subjective narrative intent: emphasize what the designated character notices, while retaining the explicitly selected external framing or overhead angle. Do not force a literal first-person camera that contradicts that explicit viewpoint.';
  return option.prompt;
}

/** A human-readable counterpart to the exact same precedence used for generation. */
export function cinemaDirectionLabel(scene: { camera?: string; cinematography?: Cinematography }): string {
  const settings = scene.cinematography;
  const descriptions = CINEMA_FIELDS.flatMap(field => {
    if (field.key === 'era') return historicalDirectionLabel(settings) ? [historicalDirectionLabel(settings)] : [];
    if (!cinemaFieldIsActive(settings, field.key)) return [];
    const option = field.options.find(option => option.value === settings?.[field.key]);
    return option ? [`${field.label}: ${option.label}`] : [];
  });
  if (!settings?.framing && !settings?.movement && scene.camera?.trim()) descriptions.unshift(scene.camera.trim());
  return descriptions.join(' · ');
}

/** Legacy camera style stays stored for undo/compatibility, but cannot contradict explicit choices. */
function legacyCameraStyleIsActive(settings?: Cinematography): boolean {
  if (!settings?.cameraStyle) return true;
  const { cameraStyle, filmFormat, filmStock, cameraBody } = settings;
  if (cameraStyle === 'digital-clean') return !filmFormat && !filmStock && cameraBody !== 'film-motion' && cameraBody !== 'dv-tape';
  if (cameraStyle === 'film-35') return !filmFormat || filmFormat === '35mm';
  if (cameraStyle === 'film-16') return !filmFormat || filmFormat === '16mm' || filmFormat === 'super16';
  return (!filmFormat || filmFormat === '65mm') && !(['broadcast', 'dv-tape', 'action', 'smartphone'] as string[]).includes(cameraBody ?? '');
}

export function cinemaFieldIsActive(settings: Cinematography | undefined, key: CinemaFieldKey): boolean {
  if (key === 'fStop') return cinemaApertureIsCoherent(settings);
  if (key === 'cameraStyle') return legacyCameraStyleIsActive(settings);
  // A lens family describes construction; the numeric focal length describes perspective.
  if (key === 'lens' && settings?.lens === 'anamorphic' && settings.lensFamily) return false;
  return true;
}

const historicalModeLabels: Record<NonNullable<HistoricalContext['mode']>, string> = {
  faithful: 'Verosímil', stylized: 'Estilizada', alternate: 'Historia alternativa',
};
const historicalModePrompts: Record<NonNullable<HistoricalContext['mode']>, string> = {
  faithful: 'Aim for plausible period-specific architecture, environments and background technology based on the supplied place and brief; avoid unintended anachronisms. This is creative guidance, not verified historical research.',
  stylized: 'Use the period as a stylized artistic interpretation, keeping the script and explicitly stated continuity details authoritative over generic period conventions.',
  alternate: 'Treat this as an explicitly fictional alternate history. Follow the intentional departures in the user brief without presenting them as historical facts.',
};

function boundedHistoricalText(value: string | undefined, limit: number): string {
  return typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, limit) : '';
}

function activeHistoricalSetting(settings?: Cinematography) {
  const era = CINEMA_FIELDS.find(field => field.key === 'era')?.options.find(option => option.value === settings?.era);
  if (!era) return undefined;
  const context = settings?.historicalContext;
  const mode = HISTORICAL_MODES.includes(context?.mode as NonNullable<HistoricalContext['mode']>) ? context!.mode! : 'faithful';
  return {
    era: settings!.era!, label: era.label, prompt: era.prompt, mode,
    year: boundedHistoricalText(context?.year, HISTORICAL_CONTEXT_LIMITS.year),
    location: boundedHistoricalText(context?.location, HISTORICAL_CONTEXT_LIMITS.location),
    notes: boundedHistoricalText(context?.notes, HISTORICAL_CONTEXT_LIMITS.notes),
  };
}

/** The period is a story setting, independent of the era of the camera or film finish. */
export function buildHistoricalPrompt(settings?: Cinematography): string {
  const history = activeHistoricalSetting(settings);
  if (!history) return '';
  const brief = Object.fromEntries((['year', 'location', 'notes'] as const).flatMap(key => history[key] ? [[key, history[key]]] : []));
  return [
    `Story period: ${history.prompt}`,
    Object.keys(brief).length ? `User-supplied period brief (creative direction, not verified historical facts): ${JSON.stringify(brief)}. The specific year/date and place refine the broad period selection.` : '',
    historicalModePrompts[history.mode],
    'Preserve every locked character identity, face, voice, reference and explicit scene continuity. Do not automatically replace wardrobe, appearance or carried objects to match a generic period stereotype; the script and explicit continuity choices take priority.',
  ].filter(Boolean).join('\n');
}

export function historicalDirectionLabel(settings?: Cinematography): string {
  const history = activeHistoricalSetting(settings);
  if (!history) return '';
  return `Época: ${[history.label, history.year, history.location, historicalModeLabels[history.mode]].filter(Boolean).join(' · ')}`;
}

/** Stable semantic comparison; inactive notes and incidental outer whitespace are ignored. */
export function historicalSettingSignature(settings?: Cinematography): string {
  const history = activeHistoricalSetting(settings);
  return history ? JSON.stringify({ era: history.era, year: history.year, location: history.location, notes: history.notes.replace(/\r\n/g, '\n'), mode: history.mode }) : '';
}

/** An explicit full reset; merely selecting no period keeps dormant notes for later editing. */
export function clearHistoricalSetting(settings: Cinematography): Cinematography {
  const next = { ...settings };
  delete next.era;
  delete next.historicalContext;
  return next;
}

/** Copy story time/place only, retaining the destination's lenses, film, camera and composition. */
export function copyHistoricalSetting(source: Cinematography | undefined, target: Cinematography): Cinematography {
  const next = clearHistoricalSetting(target);
  if (!activeHistoricalSetting(source)) return next;
  next.era = source!.era;
  if (source!.historicalContext) next.historicalContext = { ...source!.historicalContext };
  return next;
}

/** These are non-blocking editorial hints, never automatic edits to footage or continuity. */
export function cinemaSettingWarnings(settings?: Cinematography): string[] {
  if (!settings) return [];
  const warnings: string[] = [];
  if (settings.cameraStyle && !legacyCameraStyleIsActive(settings)) warnings.push('El formato, acabado o cámara elegido tiene prioridad sobre el carácter de cámara anterior; ese carácter sigue guardado, pero no se envía como indicación contradictoria.');
  if (settings.lens === 'anamorphic' && settings.lensFamily && settings.lensFamily !== 'anamorphic') warnings.push('El nuevo tipo de lente tiene prioridad sobre la indicación anamórfica anterior.');
  if (!cinemaApertureIsCoherent(settings)) warnings.push('La profundidad de campo tiene prioridad sobre la apertura sugerida incompatible.');
  if ((settings.filmStock === 'bw-negative' || settings.filmStock === 'bw-reversal') && settings.palette && settings.palette !== 'monochrome') warnings.push('Has combinado una emulsión en blanco y negro con una paleta en color. Revisa qué acabado quieres priorizar.');
  if (subjectiveViewConflicts(settings)) warnings.push('El POV sugiere mirar desde el personaje, pero el encuadre o ángulo elegido lo observa desde fuera. Se conserva tu encuadre explícito y el POV queda como intención subjetiva.');
  if ((settings.takeType === 'establishing' || settings.takeType === 'master') && (settings.framing === 'close-up' || settings.framing === 'extreme-close-up')) warnings.push('El encuadre cercano limita cuánto puede verse del lugar o de la acción completa. Se conserva el tamaño de plano que elegiste; revisa si basta para esta toma.');
  if (settings.takeType === 'sequence') warnings.push('El plano secuencia mantiene una toma continua dentro de la duración elegida, con el máximo de 15 segundos por clip. Para una acción más larga, divide el guion en planos conectados.');
  if (settings.movement === 'whip-pan' && (settings.pace === 'still' || settings.pace === 'gentle')) warnings.push('El barrido es rápido aunque la actuación sea pausada. Mantén un inicio y un final legibles para comprobar el rostro, el vestuario y los objetos.');
  if (settings.movement === 'dolly-zoom' && settings.lensFamily && settings.lensFamily !== 'zoom') warnings.push('El dolly zoom necesita variar la focal durante el desplazamiento. El tipo de lente conserva su carácter visual; el movimiento pide esa variación, no una focal constante.');
  const history = activeHistoricalSetting(settings);
  if (history && !history.location) warnings.push('Añade un lugar o cultura para concretar la época: una misma fecha no tiene una apariencia universal.');
  if (history?.era === 'custom' && !history.year && !history.notes) warnings.push('Describe el año, intervalo o reglas de tu época personalizada.');
  const decade = history?.era.match(/^(\d{3})0s$/);
  if (history?.mode !== 'alternate' && decade && /^\d{1,6}$/.test(history?.year ?? '')) {
    const start = Number(decade[1]) * 10, year = Number(history!.year);
    if (year < start || year > start + 9) warnings.push('El año escrito queda fuera de la década elegida. El año concreto orientará el detalle; revisa la época o elige una personalizada.');
  }
  return warnings;
}

/** Aperture values are creative shorthand, never measured lens behaviour. */
export const CINEMA_APERTURE_DEPTH: Record<NonNullable<Cinematography['fStop']>, NonNullable<Cinematography['aperture']>> = {
  'f1.4': 'shallow', 'f2.8': 'shallow', 'f5.6': 'balanced', 'f11': 'deep',
};

export function cinemaApertureIsCoherent(settings?: Cinematography): boolean {
  return !settings?.fStop || !settings.aperture || CINEMA_APERTURE_DEPTH[settings.fStop] === settings.aperture;
}

/** Keep the two depth controls consistent without touching clips, characters or other choices. */
export function changeCinemaSetting(settings: Cinematography, key: CinemaFieldKey, value: string): Cinematography {
  const next = { ...settings };
  if (!value) delete next[key];
  else {
    if (!(CINEMA_VALUES[key] as readonly string[]).includes(value)) return next;
    (next as Record<string, string>)[key] = value;
    if (key === 'fStop') next.aperture = CINEMA_APERTURE_DEPTH[value as NonNullable<Cinematography['fStop']>];
    if (key === 'aperture' && !cinemaApertureIsCoherent(next)) delete next.fStop;
  }
  return next;
}
