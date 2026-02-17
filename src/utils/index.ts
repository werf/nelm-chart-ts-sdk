import {RenderHandler, RenderContext} from '../types';

export const runRender = async (handler: RenderHandler)=> {
    const ctx: RenderContext = await new Response(Deno.stdin.readable).json();

    const result = await handler(ctx);

    console.log("NELM_RENDER_RESULT:", JSON.stringify(result));
}