import { Plus } from "lucide-react";
import { Form, useNavigation } from "react-router";
import { Button } from "~/components/ui/button";

/** + New quote: posts to /quotes, which creates a draft and opens the builder. */
export function NewQuoteButton({
  clientId,
  size = "lg",
  variant = "tinted",
}: {
  clientId?: string;
  size?: "md" | "lg";
  variant?: "tinted" | "primary" | "secondary";
}) {
  const navigation = useNavigation();
  return (
    <Form method="post" action="/quotes">
      {clientId && <input type="hidden" name="clientId" value={clientId} />}
      <Button
        type="submit"
        size={size}
        variant={variant}
        loading={navigation.state !== "idle" && navigation.formAction === "/quotes"}
      >
        <Plus aria-hidden />
        New quote
      </Button>
    </Form>
  );
}
