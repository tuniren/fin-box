const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const svgPath = path.join(root, "public", "assets", "app-icon.svg");
const outPath = path.join(root, "public", "assets", "app-icon.ico");
const sizes = [16, 24, 32, 48, 64, 128, 256];
const viewBox = [0, 0, 16, 16];
const samples = 4;

function createIcoFromSvg() {
  const svg = fs.readFileSync(svgPath, "utf8");
  const pathData = readPathData(svg);
  const subpaths = parsePath(pathData).map(flattenSubpath);
  const images = sizes.map((size) => createDibImage(rasterize(subpaths, size), size, size));

  const count = images.length;
  const directorySize = 6 + count * 16;
  const totalSize = directorySize + images.reduce((sum, image) => sum + image.length, 0);
  const buffer = Buffer.alloc(totalSize);

  buffer.writeUInt16LE(0, 0);
  buffer.writeUInt16LE(1, 2);
  buffer.writeUInt16LE(count, 4);

  let imageOffset = directorySize;
  images.forEach((image, index) => {
    const size = sizes[index];
    const entryOffset = 6 + index * 16;

    buffer.writeUInt8(size === 256 ? 0 : size, entryOffset);
    buffer.writeUInt8(size === 256 ? 0 : size, entryOffset + 1);
    buffer.writeUInt8(0, entryOffset + 2);
    buffer.writeUInt8(0, entryOffset + 3);
    buffer.writeUInt16LE(1, entryOffset + 4);
    buffer.writeUInt16LE(32, entryOffset + 6);
    buffer.writeUInt32LE(image.length, entryOffset + 8);
    buffer.writeUInt32LE(imageOffset, entryOffset + 12);

    image.copy(buffer, imageOffset);
    imageOffset += image.length;
  });

  return buffer;
}

function readPathData(svg) {
  const match = svg.match(/<path\b[^>]*\sd="([^"]+)"/i);
  if (!match) throw new Error(`No path data found in ${path.relative(root, svgPath)}.`);
  return match[1];
}

function parsePath(data) {
  const tokens = data.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/g) ?? [];
  const subpaths = [];
  let current;
  let command = "";
  let index = 0;
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;

  const isCommand = (value) => /^[a-zA-Z]$/.test(value);
  const readNumber = () => Number(tokens[index++]);

  while (index < tokens.length) {
    if (isCommand(tokens[index])) command = tokens[index++];
    const relative = command === command.toLowerCase();
    const type = command.toUpperCase();

    if (type === "M") {
      x = readNumber();
      y = readNumber();
      if (relative) {
        x += startX;
        y += startY;
      }
      current = [{ type: "M", x, y }];
      subpaths.push(current);
      startX = x;
      startY = y;
      command = relative ? "l" : "L";
      continue;
    }

    if (!current) throw new Error("Path data must start with a move command.");

    if (type === "L") {
      while (index < tokens.length && !isCommand(tokens[index])) {
        const nextX = readNumber();
        const nextY = readNumber();
        x = relative ? x + nextX : nextX;
        y = relative ? y + nextY : nextY;
        current.push({ type: "L", x, y });
      }
      continue;
    }

    if (type === "H") {
      while (index < tokens.length && !isCommand(tokens[index])) {
        const nextX = readNumber();
        x = relative ? x + nextX : nextX;
        current.push({ type: "L", x, y });
      }
      continue;
    }

    if (type === "V") {
      while (index < tokens.length && !isCommand(tokens[index])) {
        const nextY = readNumber();
        y = relative ? y + nextY : nextY;
        current.push({ type: "L", x, y });
      }
      continue;
    }

    if (type === "C") {
      while (index < tokens.length && !isCommand(tokens[index])) {
        const x1 = readNumber();
        const y1 = readNumber();
        const x2 = readNumber();
        const y2 = readNumber();
        const x3 = readNumber();
        const y3 = readNumber();
        const curve = {
          type: "C",
          x1: relative ? x + x1 : x1,
          y1: relative ? y + y1 : y1,
          x2: relative ? x + x2 : x2,
          y2: relative ? y + y2 : y2,
          x: relative ? x + x3 : x3,
          y: relative ? y + y3 : y3
        };
        current.push(curve);
        x = curve.x;
        y = curve.y;
      }
      continue;
    }

    if (type === "Z") {
      current.push({ type: "Z", x: startX, y: startY });
      x = startX;
      y = startY;
      continue;
    }

    throw new Error(`Unsupported SVG path command: ${command}`);
  }

  return subpaths;
}

function flattenSubpath(commands) {
  const points = [];
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;

  for (const command of commands) {
    if (command.type === "M") {
      x = command.x;
      y = command.y;
      startX = x;
      startY = y;
      points.push([x, y]);
      continue;
    }

    if (command.type === "L") {
      x = command.x;
      y = command.y;
      points.push([x, y]);
      continue;
    }

    if (command.type === "C") {
      const fromX = x;
      const fromY = y;
      for (let step = 1; step <= 12; step += 1) {
        const t = step / 12;
        points.push([
          cubic(fromX, command.x1, command.x2, command.x, t),
          cubic(fromY, command.y1, command.y2, command.y, t)
        ]);
      }
      x = command.x;
      y = command.y;
      continue;
    }

    if (command.type === "Z") {
      x = startX;
      y = startY;
      points.push([x, y]);
    }
  }

  return points;
}

function cubic(p0, p1, p2, p3, t) {
  const mt = 1 - t;
  return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
}

function rasterize(subpaths, size) {
  const pixels = new Uint8ClampedArray(size * size * 4);
  const [minX, minY, vbWidth, vbHeight] = viewBox;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let covered = 0;
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const svgX = minX + ((x + (sx + 0.5) / samples) / size) * vbWidth;
          const svgY = minY + ((y + (sy + 0.5) / samples) / size) * vbHeight;
          if (insidePath(svgX, svgY, subpaths)) covered += 1;
        }
      }

      if (covered === 0) continue;
      const index = (y * size + x) * 4;
      pixels[index] = 0;
      pixels[index + 1] = 0;
      pixels[index + 2] = 0;
      pixels[index + 3] = Math.round((covered / (samples * samples)) * 255);
    }
  }

  return pixels;
}

function insidePath(x, y, subpaths) {
  let winding = 0;
  for (const points of subpaths) {
    for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
      const [x1, y1] = points[j];
      const [x2, y2] = points[i];
      if (y1 <= y) {
        if (y2 > y && isLeft(x1, y1, x2, y2, x, y) > 0) winding += 1;
      } else if (y2 <= y && isLeft(x1, y1, x2, y2, x, y) < 0) {
        winding -= 1;
      }
    }
  }
  return winding !== 0;
}

function isLeft(x1, y1, x2, y2, x, y) {
  return (x2 - x1) * (y - y1) - (x - x1) * (y2 - y1);
}

function createDibImage(pixels, width, height) {
  const headerSize = 40;
  const xorSize = width * height * 4;
  const maskStride = Math.ceil(width / 32) * 4;
  const maskSize = maskStride * height;
  const buffer = Buffer.alloc(headerSize + xorSize + maskSize);

  buffer.writeUInt32LE(headerSize, 0);
  buffer.writeInt32LE(width, 4);
  buffer.writeInt32LE(height * 2, 8);
  buffer.writeUInt16LE(1, 12);
  buffer.writeUInt16LE(32, 14);
  buffer.writeUInt32LE(0, 16);
  buffer.writeUInt32LE(xorSize, 20);
  buffer.writeInt32LE(0, 24);
  buffer.writeInt32LE(0, 28);
  buffer.writeUInt32LE(0, 32);
  buffer.writeUInt32LE(0, 36);

  const pixelOffset = headerSize;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const src = ((height - 1 - y) * width + x) * 4;
      const dst = pixelOffset + (y * width + x) * 4;
      buffer[dst] = pixels[src + 2];
      buffer[dst + 1] = pixels[src + 1];
      buffer[dst + 2] = pixels[src];
      buffer[dst + 3] = pixels[src + 3];
    }
  }

  return buffer;
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, createIcoFromSvg());
console.log(`Generated ${path.relative(root, outPath)} from ${path.relative(root, svgPath)} with ${sizes.length} image sizes.`);