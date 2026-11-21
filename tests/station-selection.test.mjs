import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function dashboard() {
  const states = [];
  let index = 0, stations = [], routeOrigin;
  const components = new Map();
  const place = { id: 'from', name: '출발지', lat: 37.53, lng: 126.94 };
  const element = (type, props) => ({ type, props });
  const react = {
    useState: initial => { const i = index++; if (!(i in states)) states[i] = initial; return [states[i], value => { states[i] = value; }]; },
    useMemo: fn => fn(), useCallback: fn => fn,
  };
  const libraries = { places: [place, { ...place, id: 'to', name: '목적지' }], LATEST_ACCIDENT_YEAR: 2025,
    compareRoutes: () => [], formatDistance: n => `${n} m`, formatWeatherTime: () => '수집시각' };
  const loaded = { exports: {} };
  const js = ts.transpileModule(fs.readFileSync('src/app/page.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(js, { module: loaded, exports: loaded.exports, JSON,
    require: name => {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx: element, jsxs: element };
      if (name === '@/hooks/use-stations') return { useStations: () => ({ stations, loading: false }) };
      if (name === '@/hooks/use-weather') return { useWeather: () => ({}) };
      if (name === '@/hooks/use-accidents') return { useAccidents: () => ({ zones: [] }) };
      if (name === '@/hooks/use-bicycle-routes') return { useBicycleRoutes: origin => { routeOrigin = origin; return { routes: [], loading: false }; } };
      if (name.startsWith('@/lib/')) return libraries;
      if (!components.has(name)) components.set(name, () => null);
      return { default: components.get(name) };
    },
  });
  return {
    setStations: value => { stations = value; },
    render() {
      index = 0;
      const tree = loaded.exports.default(), nodes = [];
      function walk(node) { if (!node || typeof node !== 'object') return; if (Array.isArray(node)) return node.forEach(walk); nodes.push(node); walk(node.props?.children); }
      walk(tree);
      return { origin: routeOrigin, nodes,
        button: nodes.find(n => n.type === 'button' && n.props.type === 'submit'),
        from: nodes.find(n => n.type === components.get('@/components/place-search') && n.props.label === '출발'),
      };
    },
  };
}
const station = (id, bikes, distanceMeters) => ({ id, name: id, bikes, distanceMeters, slots: 20, lat: 37.53, lng: 126.94 });

test('actual nearby available station enables routing and manual selection reaches the routing hook', () => {
  const app = dashboard();
  assert.equal(app.render().button.props.disabled, true);
  app.setStations([station('empty', 0, 10), station('nearest', 2, 20), station('other', 3, 30)]);
  let view = app.render();
  assert.equal(view.origin.id, 'nearest');
  assert.equal(view.button.props.disabled, false);
  view.nodes.find(n => n.type === 'button' && n.props.className === 'station-row ' && n.props.children?.[1]?.props.children?.[0]?.props.children === 'other').props.onClick();
  view = app.render();
  assert.equal(view.origin.id, 'other');
  view.from.props.onSelect({ id: 'new', name: '새 출발지', lat: 37.55, lng: 126.95 });
  app.setStations([]);
  assert.equal(app.render().button.props.disabled, true);
  app.setStations([station('new-nearest', 1, 50)]);
  assert.equal(app.render().origin.id, 'new-nearest');
});

test('no stations or only empty stations never enables automatic routing', () => {
  const app = dashboard();
  app.setStations([station('empty', 0, 10)]);
  assert.equal(app.render().origin, null);
  assert.equal(app.render().button.props.disabled, true);
});
