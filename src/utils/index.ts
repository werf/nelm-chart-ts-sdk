import {RenderHandler, RenderContext, BaseRenderContext} from '../types';
import {parseArgs} from "node:util";
import {readFile, writeFile} from "node:fs/promises";
import {load, dump, DUMP_SCHEMA, FAILSAFE_SCHEMA, NOT_RESOLVED, Schema, boolYaml11Tag, defineScalarTag, mapTag, mergeTag, nullYaml11Tag} from "js-yaml";

// Nelm reads values with sigs.k8s.io/yaml (go-yaml v2), so the input is resolved the same way:
// YAML 1.1 booleans and nulls, Go integer literals (0755 is octal), merge keys, timestamps as strings
// and duplicate keys overriding earlier ones.
const GO_INT_PATTERN = /^(?:0[xX][0-9a-fA-F]+|0[oO][0-7]+|0[bB][01]+|0[0-7]*|[1-9][0-9]*)$/;
const GO_FLOAT_PATTERN = /^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)(?:[eE][-+]?[0-9]+)?$/;
const GO_FLOAT_SPECIALS: Record<string, number> = {
    ".nan": NaN, ".NaN": NaN, ".NAN": NaN,
    ".inf": Infinity, ".Inf": Infinity, ".INF": Infinity,
    "+.inf": Infinity, "+.Inf": Infinity, "+.INF": Infinity,
    "-.inf": -Infinity, "-.Inf": -Infinity, "-.INF": -Infinity,
};

const inputSchema = new Schema([
    ...FAILSAFE_SCHEMA.tags,
    nullYaml11Tag,
    boolYaml11Tag,
    defineScalarTag("tag:yaml.org,2002:int", {
        implicit: true,
        implicitFirstChars: ["-", "+", ..."0123456789"],
        resolve: (source) => {
            const plain = source.replaceAll("_", "");
            const sign = plain[0] === "-" || plain[0] === "+" ? plain[0] : "";
            const digits = plain.slice(sign.length);
            if (!GO_INT_PATTERN.test(digits)) {
                return NOT_RESOLVED;
            }
            const value = BigInt(/^0[0-7]/.test(digits) ? `0o${digits.slice(1)}` : digits);
            return Number(sign === "-" ? -value : value);
        },
        identify: () => false,
    }),
    defineScalarTag("tag:yaml.org,2002:float", {
        implicit: true,
        implicitFirstChars: ["-", "+", ".", ..."0123456789"],
        resolve: (source) => {
            if (source in GO_FLOAT_SPECIALS) {
                return GO_FLOAT_SPECIALS[source];
            }
            const plain = source.startsWith(".") ? source : source.replaceAll("_", "");
            const value = Number(plain);
            return GO_FLOAT_PATTERN.test(plain) && Number.isFinite(value) ? value : NOT_RESOLVED;
        },
        identify: () => false,
    }),
    mergeTag,
]);

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
    const ctx = load(inputData, {schema: inputSchema, json: true}) as RenderCtxType;

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
