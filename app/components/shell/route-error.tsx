import { isRouteErrorResponse, useRevalidator, useRouteError } from "react-router";
import { ErrorState } from "../ui/states";

/** Error with Retry for any screen inside the shell (SPEC 6.11 ErrorState). */
export function RouteErrorBoundary() {
  const error = useRouteError();
  const revalidator = useRevalidator();
  let message = "Something went wrong loading this screen. Check your connection and try again.";
  let title = "Couldn't load this";
  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      title = "Not found";
      message = "It may have been archived, or the link is wrong.";
    } else if (error.status === 403) {
      title = "Not allowed";
      message = typeof error.data === "string" ? error.data : "Only the owner can see this.";
    }
  }
  return (
    <ErrorState
      title={title}
      message={message}
      onRetry={() => revalidator.revalidate()}
      retrying={revalidator.state === "loading"}
      className="my-6"
    />
  );
}
