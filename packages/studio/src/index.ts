// @fwm/studio public API.
import './styles/studio.css';

export { Basalt, type BasaltProps } from './devices/basalt/Basalt';
export { BASALT_PRESETS, type Preset } from './devices/basalt/presets';
export { Scope } from './devices/Scope';
export { EngineProvider, useEngine, type EngineStatus } from './engine/EngineProvider';
export { useDeviceState, useDeviceSync, useEffectiveValue, useModSources } from './engine/useDeviceSync';
export { useComputerKeys, KEY_MAP } from './hooks/useComputerKeys';
export { canRoute, createDeviceStore, defaults, modRange, MAX_ROUTES, type DeviceState, type DeviceStore, type Route } from './model/deviceStore';
export { formatParam, toPhysical } from './model/params';
export * from './primitives';
export { ThemeRoot, useDeviceTokens, usePrimitives, type StudioTheme } from './theme/Theme';
