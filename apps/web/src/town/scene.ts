import { Application, Container, Graphics, Text } from 'pixi.js';
import type { Position, TownMap } from '../../../api/src/simulation/types';
import type { SensorMarker } from '../../../api/src/sensors/virtual-sensors';
import type { MotionBuffer } from './motion';

const HALF_WIDTH = 24;
const HALF_HEIGHT = 12;
const COLORS = [0x677f9b, 0xbd7f65, 0x9783a0, 0xbd9f60, 0x708d73, 0x8097ad];
const POI_COLORS = { bakery: 0xa86846, fountain: 0x739e98, market: 0xae7951, park: 0x77904c };

function iso(x: number, y: number): Position {
  return { x: (x - y) * HALF_WIDTH, y: (x + y) * HALF_HEIGHT };
}

function footprint(x: number, y: number, width = 1, depth = 1) {
  return [iso(x - 0.5, y - 0.5), iso(x + width - 0.5, y - 0.5), iso(x + width - 0.5, y + depth - 0.5), iso(x - 0.5, y + depth - 0.5)];
}

function lift(point: Position, height: number) {
  return { x: point.x, y: point.y - height };
}

function shade(color: number, factor: number) {
  return (Math.round(((color >> 16) & 255) * factor) << 16)
    | (Math.round(((color >> 8) & 255) * factor) << 8)
    | Math.round((color & 255) * factor);
}

function block(graphic: Graphics, points: Position[], base: number, height: number, color: number) {
  const [top, right, bottom, left] = points;
  graphic.poly([lift(left, base), lift(bottom, base), lift(bottom, height), lift(left, height)]).fill(color)
    .poly([lift(bottom, base), lift(right, base), lift(right, height), lift(bottom, height)]).fill(shade(color, 0.83))
    .poly([top, right, bottom, left].map(point => lift(point, height))).fill(shade(color, 0.95));
}

function faceDetail(graphic: Graphics, start: Position, end: Position, a: number, b: number, bottom: number, height: number, color: number) {
  const left = { x: start.x + (end.x - start.x) * a, y: start.y + (end.y - start.y) * a };
  const right = { x: start.x + (end.x - start.x) * b, y: start.y + (end.y - start.y) * b };
  graphic.poly([lift(left, bottom), lift(right, bottom), lift(right, bottom + height), lift(left, bottom + height)]).fill(color);
}

function drawBuilding(building: TownMap['buildings'][number], index: number) {
  const { x, y, width, depth, height, color } = building;
  const points = footprint(x, y, width, depth);
  const [top, right, bottom, left] = points;
  const graphic = new Graphics();
  const roofHeight = 19 + index % 3 * 2;
  const roofColor = [0xa34e32, 0x94482e, 0xae603d, 0x80553d, 0x5b7461][index % 9 === 0 ? 4 : index % 4];
  block(graphic, points, 0, height, color);
  faceDetail(graphic, left, bottom, 0.44, 0.61, 0, 13, 0x63705b);
  for (const a of [0.12, 0.73]) {
    faceDetail(graphic, left, bottom, a - 0.02, a + 0.18, 8, 9, 0xd3d4b0);
    faceDetail(graphic, left, bottom, a, a + 0.16, 9, 7, 0x61796c);
    faceDetail(graphic, left, bottom, a + 0.07, a + 0.085, 9, 7, 0xece8c9);
  }
  for (const a of [0.18, 0.62]) faceDetail(graphic, bottom, right, a, a + 0.18, 8, 7, 0x607368);
  if (height > 25) {
    faceDetail(graphic, left, bottom, 0.15, 0.3, 20, 5, 0x738273);
    faceDetail(graphic, left, bottom, 0.73, 0.88, 20, 5, 0x738273);
  }
  const ridgeA = lift(iso(x - 0.5, y + depth / 2 - 0.5), height + roofHeight);
  const ridgeB = lift(iso(x + width - 0.5, y + depth / 2 - 0.5), height + roofHeight);
  graphic.poly([lift(right, height), lift(bottom, height), ridgeB]).fill(shade(color, 0.9))
    .poly([lift(top, height), lift(right, height), ridgeB, ridgeA]).fill(shade(roofColor, 0.82))
    .poly([ridgeA, ridgeB, lift(bottom, height), lift(left, height)]).fill(roofColor)
    .moveTo(left.x, left.y - height).lineTo(bottom.x, bottom.y - height).stroke({ color: shade(roofColor, 0.77), width: 1.5 });
  if (index % 3 !== 0) block(graphic, footprint(x + 0.35, y + 0.65, 0.24, 0.26), height + 11, height + roofHeight + 9, 0xd8c6a2);
  if (x === 12 && y === 12) {
    for (let i = 0; i < 8; i++) {
      graphic.poly(footprint(x + i * width / 8, y + depth - 0.4, width / 8, 0.9).map(point => lift(point, 15)))
        .fill(i % 2 ? 0xb76243 : 0xf6edcf);
    }
  }
  graphic.zIndex = x + y + width + depth - 1;
  return graphic;
}

function drawTree(x: number, y: number) {
  const variant = (x * 13 + y * 7) % 5;
  const graphic = new Graphics().ellipse(7, 3, 14, 6).fill({ color: 0x557332, alpha: 0.16 })
    .rect(-2, -20, 4, 20).fill(0x927147);
  if (variant === 0) {
    graphic.poly([-13, -12, 0, -43, 13, -12]).fill(0x6b914f)
      .poly([0, -43, 13, -12, 0, -12]).fill(0x50783f)
      .poly([-10, -25, 0, -47, 10, -25]).fill(0x729853);
  } else {
    const height = 25 + variant * 3;
    graphic.ellipse(1, -height, 13, 17).fill(0x608447)
      .ellipse(-4, -height - 5, 10, 13).fill([0x8eae64, 0xa0bd73, 0x88aa5c, 0x94b36c][variant - 1])
      .ellipse(6, -height + 1, 7, 11).fill({ color: 0x7c9e53, alpha: 0.75 });
  }
  const point = iso(x, y);
  graphic.position.set(point.x, point.y);
  graphic.zIndex = x + y;
  return graphic;
}

function drawFence(building: TownMap['buildings'][number]) {
  const { x, y, width, depth } = building;
  const graphic = new Graphics();
  const start = iso(x - 0.3, y + depth + 0.6);
  const end = iso(x + width - 0.5, y + depth + 0.6);
  for (const height of [3, 7]) graphic.moveTo(start.x, start.y - height).lineTo(end.x, end.y - height).stroke({ color: 0xe2dec0, width: 1.8 });
  for (let i = 0; i <= 5; i++) {
    const point = { x: start.x + (end.x - start.x) * i / 5, y: start.y + (end.y - start.y) * i / 5 };
    graphic.moveTo(point.x, point.y).lineTo(point.x, point.y - 9).stroke({ color: 0xf1e8c9, width: 2 });
  }
  graphic.zIndex = x + y + width + depth + 0.4;
  return graphic;
}

function drawFountain() {
  const graphic = new Graphics()
    .ellipse(5, 5, 37, 17).fill({ color: 0x667c4c, alpha: 0.18 })
    .ellipse(0, 0, 35, 17).fill(0xbac3a2)
    .ellipse(0, -4, 35, 17).fill(0xf0edcd)
    .ellipse(0, -5, 29, 13).fill(0x7fa997)
    .ellipse(0, -6, 23, 9).stroke({ color: 0xb5d0b7, width: 1.5 })
    .rect(-3, -27, 6, 22).fill(0xe7e5c6)
    .ellipse(0, -26, 16, 6).fill(0xc8d2b6)
    .ellipse(0, -29, 16, 6).fill(0xf3f0d4)
    .ellipse(0, -30, 12, 3.5).fill(0x91b6a2)
    .rect(-2, -43, 4, 13).fill(0xe8e8cd)
    .circle(0, -44, 3).fill(0xf7f2db);
  const point = iso(22, 22);
  graphic.position.set(point.x, point.y);
  graphic.zIndex = 45;
  return graphic;
}

function drawStall(x: number, y: number, index: number) {
  const graphic = new Graphics();
  const points = footprint(x, y, 1.4, 0.85);
  block(graphic, points, 0, 8, 0xbc9562);
  for (const point of points) graphic.moveTo(point.x, point.y).lineTo(point.x, point.y - 25).stroke({ color: 0xa68250, width: 2 });
  for (let i = 0; i < 6; i++) {
    graphic.poly(footprint(x + i * 1.4 / 6, y, 1.4 / 6, 0.85).map(point => lift(point, 25)))
      .fill(i % 2 ? (index % 2 ? 0x779662 : 0xb87651) : 0xf4eac5);
  }
  graphic.zIndex = x + y + 1.3;
  return graphic;
}

function drawBench(x: number, y: number) {
  const graphic = new Graphics();
  const points = footprint(x, y, 1.1, 0.35);
  block(graphic, points, 4, 7, 0xad8757);
  for (const point of points) graphic.moveTo(point.x, point.y).lineTo(point.x, point.y - 7).stroke({ color: 0x756e46, width: 2 });
  graphic.zIndex = x + y + 1;
  return graphic;
}

function drawLabel(text: string, position: Position, color?: number) {
  const label = new Container();
  const point = iso(position.x, position.y);
  label.position.set(point.x, point.y - (color ? 28 : 0));
  const caption = new Text({ text, style: { fontFamily: 'sans-serif', fontSize: color ? 14 : 16, fontWeight: '600', fill: 0x546242 } });
  caption.anchor.set(0.5);
  const width = caption.width + (color ? 28 : 20);
  label.addChild(new Graphics().roundRect(-width / 2, -12, width, 26, 3).fill({ color: 0x607b3c, alpha: 0.16 })
    .roundRect(-width / 2, -14, width, 26, 3).fill(0xf7f4df).stroke({ color: 0xd5ddbb, width: 1 }));
  if (color) {
    label.addChild(new Graphics().circle(-width / 2 + 9, -1, 3).fill(color));
    caption.x = 4;
  }
  caption.y = -1;
  label.addChild(caption);
  return label;
}

function drawSensorMarker(position: Position, index: number) {
  const marker = new Container();
  const point = iso(position.x, position.y);
  marker.position.set(point.x, point.y);
  const caption = new Text({ text: `S${index + 1}`, style: { fontFamily: 'sans-serif', fontSize: 12, fontWeight: '600', fill: 0x546242 } });
  caption.position.set(10, 0);
  marker.addChild(new Graphics().ellipse(0, 0, 8, 4).fill({ color: 0xf7f4df, alpha: 0.9 }).stroke({ color: 0x607b59, width: 1.5 })
    .circle(0, 0, 2).fill(0x607b59), caption);
  return marker;
}

function drawNpc(index: number) {
  return new Graphics().ellipse(0, 0, 4, 2).fill({ color: 0x425831, alpha: 0.17 })
    .rect(-2.5, -5, 2, 5).fill(0x635d4f).rect(0.5, -5, 2, 5).fill(0x777564)
    .roundRect(-3.5, -13, 7, 9, 2).fill(COLORS[index % COLORS.length])
    .circle(0, -16, 3).fill(index % 3 === 0 ? 0xc99776 : 0xe3bd99)
    .ellipse(-0.5, -18, 3, 1.7).fill(index % 2 ? 0x827359 : 0x666146);
}

export async function createTownScene(host: HTMLDivElement, map: TownMap, motion: MotionBuffer, sensorMarkers: SensorMarker[], onFps: (fps: number) => void) {
  const app = new Application();
  await app.init({ width: host.clientWidth, height: host.clientHeight, backgroundColor: 0xc9d9ac, antialias: true, autoDensity: true, resolution: Math.min(window.devicePixelRatio || 1, 2), preference: 'webgl' });
  app.canvas.setAttribute('aria-label', 'Pueblo isométrico: 50 habitantes, cinco barrios, cuatro lugares de interés y seis sensores simulados S1–S6');
  host.appendChild(app.canvas);
  app.stage.eventMode = 'none';

  const world = new Container();
  const objects = new Container();
  objects.sortableChildren = true;
  const labels = new Container();
  app.stage.addChild(world);
  const land = footprint(0, 0, map.width, map.height);
  const ground = new Graphics().ellipse(30, 500, 1050, 505).fill({ color: 0x71864c, alpha: 0.14 })
    .poly([land[3], land[2], { x: land[2].x, y: land[2].y + 15 }, { x: land[3].x, y: land[3].y + 15 }]).fill(0x879b56)
    .poly([land[2], land[1], { x: land[1].x, y: land[1].y + 15 }, { x: land[2].x, y: land[2].y + 15 }]).fill(0x728948);
  const greens = [0xa9c47e, 0xb1ca87, 0xa3be75, 0xadc783, 0xb6cd8e];
  map.tiles.forEach((row, y) => row.forEach((tile, x) => {
    const plaza = x >= 20 && x < 27 && y >= 20 && y < 27;
    const market = x >= 28 && x < 35 && y >= 12 && y < 19;
    const park = x >= 12 && x < 19 && y >= 28 && y < 35;
    const color = tile === 'street' || plaza || market || (park && (x === 15 || y === 31)) ? 0xe9e0b9 : greens[(x * 7 + y * 11 + Math.floor(x / 3)) % greens.length];
    ground.poly(footprint(x, y)).fill(color);
    const tree = park ? (x + y) % 3 === 0 && x !== 15 && y !== 31 : (x * 17 + y * 11) % 13 === 0;
    if (tile === 'grass' && !plaza && !market && tree && x > 0 && y > 0 && x < 39 && y < 39) objects.addChild(drawTree(x, y));
  }));
  world.addChild(ground, objects, labels);

  map.buildings.forEach((building, index) => {
    const { x, y, width, depth } = building;
    ground.poly(footprint(x, y, width, depth).map(point => ({ x: point.x + 12, y: point.y + 6 }))).fill({ color: 0x6c8644, alpha: 0.18 });
    ground.poly(footprint(x + width * 0.47, y + depth - 0.5, 0.35, 1.1)).fill(0xe9e0b9);
    objects.addChild(drawBuilding(building, index));
    if (index % 3 === 0) objects.addChild(drawFence(building));
  });
  objects.addChild(drawFountain());
  for (const [x, y] of [[21, 25], [24, 21], [13, 31], [16, 33]]) objects.addChild(drawBench(x, y));
  [[29, 13], [32, 13], [29, 16], [32, 16]].forEach(([x, y], index) => objects.addChild(drawStall(x, y, index)));
  for (const district of map.districts) labels.addChild(drawLabel(district.name, district.labelPosition));
  for (const poi of map.pois) labels.addChild(drawLabel(poi.id, poi.position, POI_COLORS[poi.id]));
  sensorMarkers.forEach((sensor, index) => labels.addChild(drawSensorMarker(sensor.position, index)));

  const npcs = new Map<string, Graphics>();
  let frameCount = 0;
  let frameWindow = performance.now();
  app.ticker.add(() => {
    const now = performance.now();
    const sample = motion.sample(now);
    if (sample) {
      const nextAgents = new Map(sample.to.agents.map(agent => [agent.id, agent]));
      sample.from.agents.forEach((agent, index) => {
        let graphic = npcs.get(agent.id);
        if (!graphic) {
          graphic = drawNpc(index);
          npcs.set(agent.id, graphic);
          objects.addChild(graphic);
        }
        const target = nextAgents.get(agent.id)?.position ?? agent.position;
        const x = agent.position.x + (target.x - agent.position.x) * sample.alpha;
        const y = agent.position.y + (target.y - agent.position.y) * sample.alpha;
        const point = iso(x, y);
        graphic.position.set(point.x, point.y);
        graphic.zIndex = x + y;
      });
    }
    frameCount++;
    if (now - frameWindow >= 1000) {
      onFps(Math.round(frameCount * 1000 / (now - frameWindow)));
      frameCount = 0;
      frameWindow = now;
    }
  });

  let baseScale = 1;
  function fit() {
    const width = host.clientWidth;
    const height = host.clientHeight;
    if (!width || !height) return;
    app.renderer.resize(width, height);
    baseScale = Math.min((width - 56) / (map.width * HALF_WIDTH * 2), (height - 160) / (map.height * HALF_HEIGHT * 2));
    world.scale.set(baseScale);
    world.position.set(width / 2, height * 0.52 - (map.height - 1) * HALF_HEIGHT * baseScale);
  }
  const resize = new ResizeObserver(fit);
  resize.observe(host);
  fit();

  function zoom(event: WheelEvent) {
    event.preventDefault();
    const bounds = host.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    const oldScale = world.scale.x;
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? host.clientHeight : 1);
    const scale = Math.max(baseScale * 0.6, Math.min(baseScale * 4, oldScale * Math.exp(-delta * 0.0015)));
    world.position.set(x - (x - world.x) * scale / oldScale, y - (y - world.y) * scale / oldScale);
    world.scale.set(scale);
  }

  let drag: { id: number; x: number; y: number } | null = null;
  function pointerDown(event: PointerEvent) {
    if (event.button !== 0 || drag) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    host.setPointerCapture(event.pointerId);
    host.dataset.dragging = 'true';
  }
  function pointerMove(event: PointerEvent) {
    if (!drag || drag.id !== event.pointerId) return;
    world.x += event.clientX - drag.x;
    world.y += event.clientY - drag.y;
    drag.x = event.clientX;
    drag.y = event.clientY;
  }
  function pointerUp(event: PointerEvent) {
    if (!drag || drag.id !== event.pointerId) return;
    if (host.hasPointerCapture(event.pointerId)) host.releasePointerCapture(event.pointerId);
    drag = null;
    delete host.dataset.dragging;
  }
  host.addEventListener('wheel', zoom, { passive: false });
  host.addEventListener('pointerdown', pointerDown);
  host.addEventListener('pointermove', pointerMove);
  host.addEventListener('pointerup', pointerUp);
  host.addEventListener('pointercancel', pointerUp);

  return {
    destroy() {
      resize.disconnect();
      host.removeEventListener('wheel', zoom);
      host.removeEventListener('pointerdown', pointerDown);
      host.removeEventListener('pointermove', pointerMove);
      host.removeEventListener('pointerup', pointerUp);
      host.removeEventListener('pointercancel', pointerUp);
      delete host.dataset.dragging;
      app.destroy(true, { children: true });
    },
  };
}
