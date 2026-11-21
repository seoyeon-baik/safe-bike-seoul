import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

test('a late SDK success clears a previous loading timeout', () => {
  const state = [false, true, false]; // ready, failed by timeout, sdkLoaded
  let index = 0;
  const react = {
    useRef: () => ({ current: null }),
    useState: () => { const i = index++; return [state[i], value => { state[i] = value; }]; },
    useEffect() {},
  };
  const element = (type, props) => ({ type, props });
  const script = () => null;
  const loaded = { exports: {} };
  const js = ts.transpileModule(fs.readFileSync('src/components/bike-map.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  let onSdkLoaded;
  vm.runInNewContext(js, {
    module: loaded, exports: loaded.exports,
    require: name => name === 'react' ? react : name === 'react/jsx-runtime' ? { jsx: element, jsxs: element } : name === 'next/script' ? { default: script } : { modeLabel: () => '경로' },
    process: { env: { NEXT_PUBLIC_KAKAO_MAP_APP_KEY: 'public-test-key' } },
    window: { kakao: { maps: { load: callback => { onSdkLoaded = callback; } } } },
  });
  const place = { name: '서울', lat: 37.53, lng: 126.94 };
  const tree = loaded.exports.default({ destination: place, stationOrigin: place, routes: [], stations: [], accidents: [] });
  const sdk = tree.props.children.find(child => child?.type === script);
  sdk.props.onReady();
  assert.equal(state[1], true, 'timeout remains until the SDK itself has loaded');
  onSdkLoaded();
  assert.deepEqual(state, [true, false, true]);
});
