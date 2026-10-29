import { Plus } from "lucide-react";
import { Form, useNavigation } from "react-router";
import { Button } from "~/components/ui/button";

/** + New invoice: posts to /invoices, which creates a blank draft and opens the builder. */
export function NewInvoiceButton({
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
    <Form method="post" action="/invoices">
      {clientId && <input type="hidden" name="clientId" value={clientId} />}
      <Button
        type="submit"
        size={size}
        variant={variant}
        loading={navigation.state !== "idle" && navigation.formAction === "/invoices"}
      >
        <Plus aria-hidden />
        New invoice
      </Button>
    </Form>
  );
}
