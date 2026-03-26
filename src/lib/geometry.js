export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

export const toPixels = (point, width, height) => ({
  x: point.x * width,
  y: point.y * height,
});

export const toNormalized = (point, width, height) => ({
  x: clamp(point.x / width, 0, 1),
  y: clamp(point.y / height, 0, 1),
});

export const lineLength = (line) => distance(line.p1, line.p2);

export const pointToSegmentDistance = (point, a, b) => {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = point.x - a.x;
  const apy = point.y - a.y;
  const ab2 = abx * abx + aby * aby;

  if (ab2 === 0) return distance(point, a);

  const t = clamp((apx * abx + apy * aby) / ab2, 0, 1);
  const closest = { x: a.x + abx * t, y: a.y + aby * t };
  return distance(point, closest);
};

export const rotatePointAround = (point, center, radians) => {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - center.x;
  const dy = point.y - center.y;

  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
};

export const lineNormal = (line) => {
  const dx = line.p2.x - line.p1.x;
  const dy = line.p2.y - line.p1.y;
  const mag = Math.hypot(dx, dy) || 1;
  return { x: -dy / mag, y: dx / mag };
};
