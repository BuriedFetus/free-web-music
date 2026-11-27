// The manual (the Library panel): for each instrument a few pages, each with numbered spots on the real
// panel. A spot's `at` finds what it points at inside the instrument:
//   'k:Cutoff'          the first knob / slider named Cutoff ('k:Pitch#2' = the second one)
//   'h:Filter'          the section title that reads Filter
//   any CSS selector    e.g. '.fwm-preset', '[data-id="temp"]'
//   …@x,y               a point inside what was found (0..1 across, 0..1 down), e.g. a place in Geode's room

export interface Spot {
  at: string;
  title: string;
  text: string;
}
export interface Page {
  title: string;
  body: string[];
  spots: Spot[];
}
export interface Chapter {
  device: string;
  pages: Page[];
}

const SOUNDS: Spot = { at: '.fwm-preset', title: 'Sounds', text: 'Step through ready-made sounds with ‹ and ›. Change anything you like: your changes are kept in the song, for everyone. "edited" shows when you moved something.' };
const SENDS: Spot = { at: '.fwm-sends', title: 'Send to Reverb and Delay', text: 'How much of this instrument goes to the Mixer\'s Reverb and Delay. These are the same knobs as in the Mixer: turn one here and it moves there too.' };
const KEYS: Spot = { at: '.fwm-perf', title: 'Keys', text: 'Click to play, or use your computer keyboard (A S D F … play notes, Z / X change the octave). With a Key set for the song, notes outside it are dimmed and play the nearest right note.' };
const PEOPLE: Spot = { at: '.fwm-who', title: 'Who is here', text: 'Everyone looking at this instrument. When someone turns a knob, you see their colour on it.' };
const MODROW: Spot = { at: '.fwm-opal__mod', title: 'Modulation', text: 'Press Assign, then click any knob: the LFO (or an envelope) now moves that knob by itself. The arc on the knob shows where it is right now. Add as many as you like; × removes one.' };

export const MANUAL: Chapter[] = [
  {
    device: 'basalt',
    pages: [
      {
        title: 'Meet Basalt',
        body: ['Basalt is a bass synth: it plays one note at a time, so bass lines glide and stay tight.', 'Start with a sound you like, play a few notes, then turn one knob at a time and listen.'],
        spots: [SOUNDS, { at: '.fwm-keys', title: 'Keys', text: 'Click or use the computer keyboard. Hold one key and press another: Basalt slides between them (see Glide).' }, PEOPLE],
      },
      {
        title: 'Where the sound comes from',
        body: ['The sound starts at the oscillator (a buzz), then goes through the filter (which makes it darker or brighter), then the amp (which shapes how loud it is over time).'],
        spots: [
          { at: 'k:Shape', title: 'Shape', text: 'Changes the buzz itself: from round to hollow and nasal.' },
          { at: 'k:Sub', title: 'Sub', text: 'Adds a second, lower oscillator one octave down: more weight under the note.' },
          { at: 'k:Cutoff', title: 'Cutoff', text: 'The most important knob. Down = darker and softer, up = brighter.' },
          { at: 'k:Reso', title: 'Reso', text: 'Makes the filter sing at the cutoff: a squelchy, acid sound when it is high.' },
          { at: 'k:Env amt', title: 'Env amt', text: 'How much the filter opens at the start of each note: the "bwow" of a bass.' },
          { at: 'k:Drive', title: 'Drive', text: 'Warm distortion. A little makes the bass stand out on small speakers.' },
        ],
      },
      {
        title: 'Shape over time, and movement',
        body: ['Envelopes say what happens while a note plays: how fast it starts (A), falls (D), where it stays while held (S), and how long it lasts after you let go (R).'],
        spots: [
          { at: '.fwm-env', title: 'Envelope', text: 'A short A and R make a tight, plucky bass; long ones make it swell and fade.' },
          { at: 'k:Glide', title: 'Glide', text: 'How long the pitch takes to slide from one note to the next.' },
          { at: 'k:Rate', title: 'LFO', text: 'A slow movement: Rate is its speed, Amount how far it moves.' },
          { at: '.fwm-btn--assign', title: 'Assign', text: 'Press Assign, then click a knob: the LFO moves it by itself. Try Cutoff for a wobble.' },
        ],
      },
    ],
  },
  {
    device: 'garnet',
    pages: [
      {
        title: 'Meet Garnet',
        body: ['Garnet is a string instrument: strum chords or pick notes on the neck, like a guitar.', 'Chords mode plays whole chords that fit the song\'s Key; Notes mode plays single notes.'],
        spots: [
          { at: '[aria-label^="Guitar neck"]', title: 'The neck', text: 'Click a string, or drag across the strings to strum. Notes you play light up where they are on the neck.' },
          { at: '[aria-label="What the neck plays"]', title: 'Chords or Notes', text: 'Chords: each key plays a chord that fits the Key. Notes: each key plays one note.' },
          SOUNDS,
        ],
      },
      {
        title: 'Playing',
        body: ['A few things make it feel like a real instrument.'],
        spots: [
          { at: '[aria-label="Chord type"]', title: 'Chord type', text: 'Which kind of chord the keys play (major, minor, power chord…).' },
          { at: '[aria-label="Whammy"]', title: 'Whammy ribbon', text: 'Click and drag to bend the pitch, like a whammy bar. Let go and it springs back.' },
          { at: '[aria-label="Palm mute"]', title: 'Palm mute', text: 'Damps the strings: short, chunky notes.' },
          { at: '[aria-label="What the neck plays"]@0.75,0.5', title: 'Notes and the chord guide', text: 'Switch to Notes, then press Chord guide: it shows the chord your note belongs to on the neck: root light blue, 2nd light red, 3rd light green, the next chord in purple, with Roman numerals.' },
        ],
      },
      {
        title: 'Tone',
        body: ['From a clean acoustic to a loud amp.'],
        spots: [
          { at: 'k:Sustain', title: 'Sustain', text: 'How long a string rings. Held notes ring as long as you hold them.' },
          { at: 'k:Body', title: 'Body', text: 'The wooden body around the strings: more = rounder and fuller.' },
          { at: 'k:Distortion', title: 'Distortion', text: 'From warm fuzz to metal.' },
          SENDS,
        ],
      },
    ],
  },
  {
    device: 'quartz',
    pages: [
      {
        title: 'Meet Quartz',
        body: ['Quartz makes keys and bells: electric pianos, glassy bells, organs.', 'It works by letting one wave shake another (FM): small changes make big differences, so turn slowly.'],
        spots: [SOUNDS, KEYS, SENDS],
      },
      {
        title: 'The two rows',
        body: ['Each row is a pair of waves: one you hear, and one that shakes it.'],
        spots: [
          { at: 'h:Operators', title: 'Rows', text: 'Two rows, mixed together: for example a tine on top of a body.' },
          { at: 'k:Harmonics', title: 'Harmonics', text: 'How fast the shaking wave goes compared with the note: whole numbers sound musical, others sound like bells.' },
          { at: 'k:Depth', title: 'Depth', text: 'How hard it shakes: more = brighter and more metallic.' },
          { at: 'k:Env', title: 'Env', text: 'How much brighter the start of each note is: the "tine" of an electric piano.' },
        ],
      },
      {
        title: 'Touch and movement',
        body: ['Make it respond to how you play, and move by itself.'],
        spots: [
          { at: 'k:Touch', title: 'Touch', text: 'Harder playing opens the filter: soft notes are darker.' },
          { at: 'k:Tremolo', title: 'Tremolo', text: 'The volume wobbles, like a classic electric piano. Speed sets how fast.' },
          { at: 'k:Drive', title: 'Drive', text: 'Pushes it into a warm amp.' },
          MODROW,
        ],
      },
    ],
  },
  {
    device: 'opal',
    pages: [
      {
        title: 'Meet Opal',
        body: ['Opal makes pads: soft, wide sounds that hold chords and fill the room. It plays up to eight notes at once.', 'Hold a chord and turn the knobs slowly.'],
        spots: [SOUNDS, KEYS, SENDS],
      },
      {
        title: 'Oscillators',
        body: ['Opal stacks several copies of the same wave, slightly out of tune with each other: that is what makes it wide.'],
        spots: [
          { at: 'h:Oscillators', title: 'Osc 1 and Osc 2', text: 'Osc 1 is the main wave, stacked 1 to 7 times. Osc 2 adds another wave an interval above or below.' },
          { at: 'k:Detune', title: 'Detune', text: 'How far apart the stacked copies are: more = wider and richer.' },
          { at: 'k:Air', title: 'Air', text: 'A little noise, like breath.' },
        ],
      },
      {
        title: 'Filter, amp and motion',
        body: ['Pads come alive when they move slowly.'],
        spots: [
          { at: 'k:Cutoff', title: 'Cutoff', text: 'Darker or brighter.' },
          { at: 'k:Swell', title: 'Swell', text: 'How slowly the filter opens after you press a key: the pad blooms.' },
          { at: 'k:Attack', title: 'Attack and Release', text: 'Long attack = the pad fades in; long release = it lingers after you let go.' },
          { at: 'k:Movement', title: 'Movement', text: 'A slow LFO on the filter and the wave: the pad breathes.' },
          { at: '[aria-label="Chorus"]', title: 'Chorus', text: 'The classic shimmer of old pad synths. I is gentle, II deeper, I+II fast.' },
          MODROW,
        ],
      },
    ],
  },
  {
    device: 'geode',
    pages: [
      {
        title: 'Meet Geode and Mica',
        body: [
          'Geode is a sampler with a little room in it. Mica, the crystal inside, sings whatever you record into her memory.',
          'Everything in the room is a control. You never need a knob: use the big icons at the bottom.',
        ],
        spots: [
          { at: '.fwm-geode__screen@0.5,0.62', title: 'Mica', text: 'She makes the sound. Click her to open her memory; drag her around the room to move the sound left, right, near or far.' },
          { at: '.fwm-geode__dock', title: 'The dock', text: 'Every control is one of these icons. Click one to open it, click again (or press Escape) to close it.' },
          { at: '.fwm-geode__hud', title: 'Temperature', text: 'How warm the room is right now, from FREEZING to HOT. It changes the whole sound.' },
          SOUNDS,
        ],
      },
      {
        title: 'Recording into her memory',
        body: ['Geode starts empty. Record any other instrument in the song (up to 30 s), drop an audio file on the room, or try the demo tape.'],
        spots: [
          { at: '[data-id="mica"]', title: 'Her face', text: 'Opens her memory: REC, TRIM, REMOVE, PLAY, FILE. REC waits for the first sound. While it waits, your keys play the instrument you record, so just play.' },
          { at: '.fwm-geode__screen@0.92,0.35', title: 'The film strip', text: 'The tape hangs on the right wall. Drag along it to choose where the grains come from. Little lights show which part is playing.' },
          { at: '.fwm-geode__screen@0.5,0.45', title: 'Shared, not uploaded', text: 'The tape stays in your browser and goes straight to the people in the session. It is never sent to a server.' },
        ],
      },
      {
        title: 'Temperature and air',
        body: ['The thermometer is the big one: one slider changes many things at once, slowly, like a real room warming up.'],
        spots: [
          { at: '[data-id="temp"]', title: 'Thermometer', text: 'FREEZING: high, glassy, still, wide. HOT: low, heavy, saturated. Mica dresses for it: winter suit, sweater, tank top, sweat.' },
          { at: '[data-id="fan"]', title: 'Air (the window)', text: 'Opens the window: the sound gets brighter, whistles a little, and sways with the blinds.' },
          { at: '.fwm-geode__screen@0.16,0.4', title: 'The window', text: 'Watch the blinds: their sway is what you hear.' },
        ],
      },
      {
        title: 'Room, echo, light',
        body: ['Space around the sound.'],
        spots: [
          { at: '[data-id="room"]', title: 'Room', text: 'Size makes the room longer (and the reverb longer); Wet is how much of it you hear.' },
          { at: '[data-id="echo"]', title: 'Echo', text: 'Mica\'s voice bounces off the back wall, once per echo, in time with the song.' },
          { at: '[data-id="lamp"]', title: 'Light', text: 'Dim the lamp to calm the whole sound down (darker and softer).' },
          { at: '.fwm-geode__screen@0.5,0.25', title: 'The lamp', text: 'It dims with the Light control.' },
        ],
      },
      {
        title: 'Rug, door, mirror',
        body: ['Three things in the room you can grab.'],
        spots: [
          { at: '.fwm-geode__screen@0.6,0.8', title: 'The rug', text: 'Drag its corner across the floor. A bigger rug soaks up the room: the reverb tail gets darker and shorter, the slap-backs softer, and every echo a little duller.' },
          { at: '.fwm-geode__screen@0.57,0.5', title: 'The door', text: 'Pull it left to open it into the room: Geode goes out to the rest of the song (its Reverb and Delay SEND knobs). Push it back to close it.' },
          { at: '.fwm-geode__screen@0.86,0.6', title: 'The mirror', text: 'Drag it right to turn it toward the room: a wider stereo sound; left: narrower. Click it to play the tape backwards: Mica\'s reflection turns her back.' },
        ],
      },
      {
        title: 'Breath, grains, crunch, motion',
        body: ['How each note is shaped, and what moves by itself.'],
        spots: [
          { at: '[data-id="breath"]', title: 'Breath', text: 'Pluck (short notes) to Swell (slow, long notes). Mica\'s mouth follows it.' },
          { at: '[data-id="grains"]', title: 'Grains', text: 'Plays tiny slices of the tape instead of the tape itself: from plain to a cloud.' },
          { at: '[data-id="crunch"]', title: 'Crunch', text: 'Fewer bits, lower rate: a crunchy, toy-like sound.' },
          { at: '[data-id="motion"]', title: 'Motion', text: 'One movement in time with the song on the things you pick (window, pitch, pan…), and Mica can walk around the room. Drag the icon down to 0 and everything stands still, her walk too.' },
        ],
      },
    ],
  },
  {
    device: 'flint',
    pages: [
      {
        title: 'Meet Flint',
        body: ['Flint is a drum machine with eight pads. Each pad is its own drum.', 'Pick a kit, then make each drum yours.'],
        spots: [
          { at: '[aria-label^="Pads"]', title: 'Pads', text: 'Click a pad (or keys A S D F G H J K) to hear it and to pick it for editing.' },
          { at: '[aria-label="Next kit"]', title: 'Kits', text: 'Ready-made sets of eight drums.' },
          PEOPLE,
        ],
      },
      {
        title: 'Shape a drum',
        body: ['These knobs change the pad you picked.'],
        spots: [
          { at: '[aria-label$="character"]', title: 'Character', text: 'Which flavour of this drum: from vintage machine to modern.' },
          { at: 'k:Tune', title: 'Tune', text: 'Higher or lower.' },
          { at: 'k:Decay', title: 'Decay', text: 'Short and tight, or long and ringing.' },
          { at: 'k:Tone', title: 'Tone', text: 'Darker or brighter.' },
        ],
      },
    ],
  },
];

/** Find what a spot points at inside `root`; returns its centre (or the given point) relative to `origin`. */
export function locate(root: HTMLElement, origin: HTMLElement, at: string): { x: number; y: number } | null {
  const [sel, pt] = at.split('@');
  let el: Element | null | undefined = null;
  if (sel.startsWith('k:')) {
    const [name, nth] = sel.slice(2).split('#');
    el = [...root.querySelectorAll('[role="slider"]')].filter((e) => e.getAttribute('aria-label') === name)[(Number(nth) || 1) - 1];
  } else if (sel.startsWith('h:')) {
    el = [...root.querySelectorAll('.fwm-brk')].find((e) => e.textContent?.trim() === sel.slice(2));
  } else {
    try {
      el = root.querySelector(sel);
    } catch {
      el = null;
    }
  }
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (!r.width && !r.height) return null;
  const o = origin.getBoundingClientRect();
  const [fx, fy] = pt ? pt.split(',').map(Number) : [0.5, 0.5];
  return { x: r.left - o.left + r.width * fx, y: r.top - o.top + r.height * fy };
}
