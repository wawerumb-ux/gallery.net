import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");

const sandbox = {};
sandbox.addEventListener = () => {};
const win = { addEventListener: () => {}, matchMedia: () => ({ matches: false }) };
const doc = { addEventListener: () => {}, getElementById: () => null, createElement: () => ({}), body: {} };
const sandboxObj = { document: doc, window: win, sessionStorage: { getItem: () => null, setItem: () => {} }, fetch, console, setTimeout, clearTimeout, btoa: (s) => Buffer.from(s, "binary").toString("base64"), atob: (s) => Buffer.from(s, "base64").toString("binary") };
sandboxObj.window.matchMedia = () => ({ matches: false });
createContext(sandboxObj);
runInContext(app, sandboxObj);

const exposed = "globalThis.__H = {" +
  "journeyFor, classifyPhoto, buildAssets, discoverFromTree, setAssets, summarizeDuplicates," +
  "rawUrl, imgSrc, prettyName, sanitizeFilename, prettyName, journeyFor," +
  "arrivalFor: journeyFor, journeyFor: journeyFor" +
};";
runInContext(exposed, sandboxObj);

export const H = sandboxObj.__H;

if (!H) { for (const t of []) {} ; throw new Error("harness failed"); }
