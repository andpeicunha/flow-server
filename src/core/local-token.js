import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { join } from "node:path";

const tokenFile = "service.token";

export class LocalToken {
  constructor(stateDir, { fs = { mkdir, readFile, writeFile }, createToken = () => randomBytes(32).toString("base64url") } = {}) {
    this.stateDir = stateDir;
    this.fs = fs;
    this.createToken = createToken;
    this.value = undefined;
  }

  async loadOrCreate() {
    if (this.value) return this.value;
    await this.fs.mkdir(this.stateDir, { recursive: true, mode: 0o700 });
    const path = join(this.stateDir, tokenFile);
    try {
      this.value = (await this.fs.readFile(path, "utf8")).trim();
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const candidate = this.createToken();
      try {
        await this.fs.writeFile(path, `${candidate}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
        this.value = candidate;
      } catch (writeError) {
        if (writeError.code !== "EEXIST") throw writeError;
        this.value = (await this.fs.readFile(path, "utf8")).trim();
      }
    }
    if (this.value.length < 32) throw new Error("Local service token is invalid.");
    return this.value;
  }

  async matches(candidate) {
    const token = await this.loadOrCreate();
    if (typeof candidate !== "string") return false;
    const left = Buffer.from(token);
    const right = Buffer.from(candidate);
    return left.length === right.length && timingSafeEqual(left, right);
  }
}
