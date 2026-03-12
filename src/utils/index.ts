import {RenderHandler, RenderContext} from '../types';
import {parseArgs} from "node:util";
import {parse, stringify} from "@std/yaml";

export const runRender = async (handler: RenderHandler) => {
    const {values} = parseArgs({
        args: Deno.args, options: {
            "input-file": {type: "string"},
            "output-file": {type: "string"},
        }
    });

    const {["input-file"]: inputFile, ["output-file"]: outputFile} = values;

    if (!inputFile || !outputFile) {
        throw new Error("Usage: deno run src/index.ts --input-file <input-file> --output-file <output-file>");
    }

    const inputData = await Deno.readTextFile(inputFile);
    const ctx = parse(inputData) as RenderContext;

    const result = await handler(ctx);

    if (!result || !result.manifests || !Array.isArray(result.manifests)) {
        throw new Error("Handler must return an object with a 'manifests' array");
    }
    const yamlResult = result.manifests.map((manifest) => stringify(manifest)).join("---\n");

    await Deno.writeTextFile(outputFile, yamlResult);
}