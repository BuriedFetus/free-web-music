import { Button } from './Button';
import { Fader } from './Fader';
import { Keys } from './Keys';
import { Knob } from './Knob';
import { Screen } from './Screen';
import type { Primitives } from './types';

export const defaultPrimitives: Primitives = { Knob, Fader, Button, Screen, Keys };
export { Button, Fader, Keys, Knob, Screen };
export { noteName } from './Keys';
export type * from './types';
