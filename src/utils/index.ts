import {RenderHandler, RenderContext, BaseRenderContext} from '../types';
import {parseArgs} from "node:util";
import {readFile, writeFile} from "node:fs/promises";
import {load, dump, DUMP_SCHEMA, mapTag} from "js-yaml";

// js-yaml dumps only plain objects as mappings. Accept any object, like @std/yaml did,
// so that class instances (e.g. from kubernetes-models) are serialized by their own keys.
const manifestSchema = DUMP_SCHEMA.withTags({
    ...mapTag,
    identify: (data: unknown) => data !== null && typeof data === "object" && !Array.isArray(data),
});

export async function render<RenderCtxType extends BaseRenderContext = RenderContext> (handler: RenderHandler<RenderCtxType>) {
    const {values} = parseArgs({
        args: process.argv.slice(2), options: {
            "input-file": {type: "string"},
            "output-file": {type: "string"},
        }
    });

    const {["input-file"]: inputFile, ["output-file"]: outputFile} = values;

    if (!inputFile) {
        throw new Error("Usage: node bundle.js --input-file <input-file> [--output-file <output-file>]");
    }

    const inputData = await readFile(inputFile, "utf8");
    const ctx = load(inputData) as RenderCtxType;

    const result = await handler(ctx);

    if (!result || !result.manifests || !Array.isArray(result.manifests)) {
        throw new Error("Handler must return an object with a 'manifests' array");
    }
    const yamlResult = result.manifests.map((manifest) => dump(manifest, {schema: manifestSchema})).join("---\n");

    if (!outputFile) {
        console.log(`Rendered manifests:\n${yamlResult}\n`)
    } else {
        await writeFile(outputFile, yamlResult);
    }
}
