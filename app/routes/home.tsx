import type { Route } from "./+types/home";

export function meta(_: Route.MetaArgs) {
  return [
    { title: "Insides Interior" },
    { name: "description", content: "Quotes and invoicing for Insides Interior Limited." },
  ];
}

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-4 p-6">
      <h1 className="font-display text-4xl">Insides Interior</h1>
      <p className="text-lg">Quotes and invoicing. The new app is being built.</p>
    </main>
  );
}
