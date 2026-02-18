import {RenderHandler, RenderContext} from '../types';
import {parseArgs} from "node:util";

export const runRender = async (handler: RenderHandler)=> {
    const { values } = parseArgs({ args: Deno.args, options: { "ctx": { type: "string" } } })
    const ctx: RenderContext = await new Response(values.ctx).json();

    const result = await handler(ctx);

    console.log("NELM_RENDER_RESULT:", JSON.stringify(result));
}