import zlib from "node:zlib";

/** A ustar entry built by hand, for archive tests. */
export function tarEntry(name: string, data: Buffer | string, type = "0", mode = 0o755, prefix = ""): Buffer {
  const body = Buffer.from(data);
  const h = Buffer.alloc(512);
  h.write(name, 0, 100, "utf8");
  h.write(`${mode.toString(8).padStart(7, "0")}\0`, 100);
  h.write("0000000\0", 108);
  h.write("0000000\0", 116);
  h.write(`${body.length.toString(8).padStart(11, "0")}\0`, 124);
  h.write("00000000000\0", 136);
  h.write("        ", 148);
  h.write(type, 156);
  h.write("ustar\0", 257);
  h.write("00", 263);
  h.write(prefix, 345, 155, "utf8");
  let sum = 0;
  for (const b of h) sum += b;
  h.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
  return Buffer.concat([h, body, Buffer.alloc((512 - (body.length % 512)) % 512)]);
}
export const tgz = (...entries: Buffer[]) => zlib.gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)]));
