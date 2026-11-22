import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import { describe, expect, it } from 'vitest';
import * as viewport from '../src/shared/canvasViewport';

type Touch = { identifier: number; pageX: number; pageY: number };
type Event = { nativeEvent: { touches: Touch[] } };
type Handlers = Record<string, (event: Event, gesture: { dx: number; dy: number; numberActiveTouches: number }) => void>;
const touch = (identifier: number, pageX: number, pageY = 100): Touch => ({ identifier, pageX, pageY });

/** Execute the shipped responder callbacks with inert rendering, without a native device. */
function mountResponder() {
  let handlers: Handlers = {};
  let grantPoint = { pageX: 0, pageY: 0 };
  const states: unknown[] = [];
  const react = {
    useState: (initial: unknown) => { const index = states.push(initial) - 1; return [initial, (value: unknown) => { states[index] = value; }]; },
    useRef: (value: unknown) => ({ current: value }),
    useMemo: (factory: () => unknown) => factory(),
    useEffect: () => undefined
  };
  const module = { exports: {} as { CanvasGraphViewport: (props: unknown) => unknown } };
  const code = transformSync(readFileSync(new URL('../mobile/src/components/CanvasGraphViewport.tsx', import.meta.url), 'utf8'), {
    loader: 'tsx', format: 'cjs', jsx: 'automatic', target: 'es2022'
  }).code;
  runInNewContext(code, {
    module,
    exports: module.exports,
    require: (name: string) => {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx: () => null, jsxs: () => null };
      if (name === 'react-native') return { PanResponder: { create: (value: Handlers) => { handlers = value; return { panHandlers: {} }; } }, StyleSheet: { create: (value: unknown) => value } };
      if (name === '@openvideo/shared/canvasViewport') return viewport;
      if (name === '../lib/theme') return { theme: {} };
      if (name === '../lib/touch') return { press: (value: unknown) => value };
      throw new Error(`Unexpected import: ${name}`);
    }
  });
  module.exports.CanvasGraphViewport({ nodes: [], edges: [], selection: [], connectingId: null, fitKey: 0 });
  return {
    send: (name: string, ...touches: Touch[]) => {
      if (name === 'onPanResponderGrant' && touches[0]) grantPoint = touches[0];
      const point = touches[0] ?? grantPoint;
      handlers[name]?.({ nativeEvent: { touches } }, { dx: point.pageX - grantPoint.pageX, dy: point.pageY - grantPoint.pageY, numberActiveTouches: touches.length });
    },
    camera: () => states[1] as viewport.CanvasCamera
  };
}

describe('mobile canvas responder transitions', () => {
  it('starts zooming when a second finger joins an active pan', () => {
    const view = mountResponder();
    view.send('onPanResponderGrant', touch(1, 100));
    view.send('onPanResponderMove', touch(1, 120));
    expect(view.camera()).toEqual({ x: 44, y: 32, zoom: 0.85 });
    const before = view.camera();
    view.send('onPanResponderStart', touch(1, 120), touch(2, 220));
    view.send('onPanResponderMove', touch(1, 100), touch(2, 240));
    expect(view.camera().zoom).toBeCloseTo(1.19);
    expect((170 - view.camera().x) / view.camera().zoom).toBeCloseTo((170 - before.x) / before.zoom);
  });

  it('continues panning from the last pinch position with either remaining finger', () => {
    for (const remaining of [1, 2]) {
      const view = mountResponder();
      view.send('onPanResponderGrant', touch(1, 100), touch(2, 200));
      view.send('onPanResponderMove', touch(1, 80), touch(2, 220));
      const before = view.camera(), x = remaining === 1 ? 80 : 220;
      view.send('onPanResponderEnd', touch(remaining, x));
      expect(view.camera()).toEqual(before);
      view.send('onPanResponderMove', touch(remaining, x + 15, 125));
      expect(view.camera()).toEqual({ ...before, x: before.x + 15, y: before.y + 25 });
    }
  });

  it('rebases contact changes detected on move and ignores touch ordering', () => {
    const view = mountResponder();
    view.send('onPanResponderGrant', touch(1, 100));
    view.send('onPanResponderMove', touch(1, 120));
    const panned = view.camera();
    view.send('onPanResponderMove', touch(2, 220), touch(1, 120));
    expect(view.camera()).toEqual(panned);
    view.send('onPanResponderMove', touch(1, 100), touch(2, 240));
    expect(view.camera().zoom).toBeCloseTo(1.19);
    const pinched = view.camera();
    view.send('onPanResponderMove', touch(2, 240));
    expect(view.camera()).toEqual(pinched);
    view.send('onPanResponderMove', touch(2, 250));
    expect(view.camera()).toEqual({ ...pinched, x: pinched.x + 10 });
  });

  it('clears gesture baselines after release and cancellation', () => {
    for (const finish of ['onPanResponderRelease', 'onPanResponderTerminate']) {
      const view = mountResponder();
      view.send('onPanResponderGrant', touch(1, 100), touch(2, 200));
      view.send('onPanResponderMove', touch(1, 80), touch(2, 220));
      const before = view.camera();
      view.send(finish);
      view.send('onPanResponderGrant', touch(3, 300));
      view.send('onPanResponderMove', touch(3, 310));
      expect(view.camera()).toEqual({ ...before, x: before.x + 10 });
    }
  });
});
