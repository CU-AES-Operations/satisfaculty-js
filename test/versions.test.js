// The web page loads each library from the CDN at the version in package.json.
// That only works, and only matches what was tested, if the versions are exact.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { dependencies } = JSON.parse(readFileSync("package.json", "utf8"));

test("library versions in package.json are exact and are the ones installed", () => {
    for (const [name, version] of Object.entries(dependencies)) {
        assert.match(version, /^\d+\.\d+\.\d+$/, `${name}: "${version}" must be an exact version, without ^ or ~`);
        const installed = JSON.parse(readFileSync(`node_modules/${name}/package.json`, "utf8")).version;
        assert.equal(installed, version, `${name}: run npm install`);
    }
});

test("the web page takes its versions from package.json", () => {
    const page = readFileSync("index.html", "utf8");
    assert.ok(page.includes('fetch("./package.json")'));
    assert.doesNotMatch(page, /cdn\.jsdelivr\.net\/npm\/[a-z-]+@\d/, "index.html must not name a version itself");
});
