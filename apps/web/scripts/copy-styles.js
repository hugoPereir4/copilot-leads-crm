import { cpSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(packageRoot, "src", "styles");
const destination = resolve(packageRoot, "dist", "styles");

mkdirSync(destination, { recursive: true });
cpSync(source, destination, { recursive: true });
