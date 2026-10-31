import { isbot } from "isbot";
import { renderToReadableStream } from "react-dom/server";
import type { AppLoadContext, EntryContext } from "react-router";
import { ServerRouter } from "react-router";
import { describeError } from "~/lib/describe-error";
import { NonceContext } from "~/lib/nonce";
import { contentSecurityPolicy, newNonce } from "~/server/security-headers";

/** Errors in loaders, actions and rendering reach the Worker's logs with the page they hit. */
export function handleError(error: unknown, { request }: { request: Request }) {
  if (request.signal.aborted) return;
  const path = new URL(request.url).pathname;
  console.error(`route error on ${path}`, describeError(error));
}

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  _loadContext: AppLoadContext,
) {
  let shellRendered = false;
  const userAgent = request.headers.get("user-agent");
  // SPEC 11.1 strict CSP: the inline scripts React Router writes carry this nonce.
  const nonce = newNonce();

  const body = await renderToReadableStream(
    <NonceContext.Provider value={nonce}>
      <ServerRouter context={routerContext} url={request.url} nonce={nonce} />
    </NonceContext.Provider>,
    {
      nonce,
      onError(error: unknown) {
        responseStatusCode = 500;
        // Log streaming errors only; errors before the shell renders reject the
        // promise and are handled by React Router's error boundary.
        if (shellRendered) console.error(describeError(error));
      },
    },
  );
  shellRendered = true;

  // Bots and SPA-mode builds wait for the whole document before responding.
  if ((userAgent && isbot(userAgent)) || routerContext.isSpaMode) {
    await body.allReady;
  }

  responseHeaders.set("Content-Type", "text/html");
  // Vite dev injects its own inline scripts and websocket, so the policy applies to builds.
  if (!import.meta.env.DEV) {
    responseHeaders.set(
      "Content-Security-Policy",
      contentSecurityPolicy(nonce, { https: new URL(request.url).protocol === "https:" }),
    );
  }
  return new Response(body, { headers: responseHeaders, status: responseStatusCode });
}
