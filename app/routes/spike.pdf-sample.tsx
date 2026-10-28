import type { Route } from "./+types/spike.pdf-sample";
import "./spike.pdf-sample.css";

// Phase 0 PDF spike (SPEC 10.4): a static 3-page quote with Fraunces, Inter and a
// logo. Figures are display strings on purpose; no money logic lives here.

export function meta(_: Route.MetaArgs) {
  return [{ title: "PDF spike sample" }, { name: "robots", content: "noindex" }];
}

const rooms = [
  { name: "Living room", lines: 9 },
  { name: "Primary bedroom", lines: 8 },
  { name: "Dining room", lines: 9 },
  { name: "Kitchen", lines: 8 },
  { name: "Guest bedroom", lines: 12 },
];

function money(cents: number) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(cents / 100);
}

function sampleLines(room: string, count: number) {
  return Array.from({ length: count }, (_, i) => {
    const qty = (i % 4) + 1;
    const unit = 4275 + i * 1150;
    return {
      key: `${room}-${i}`,
      description: `${room}: ${["Drapery fabric", "Lining", "Installation", "Hardware", "Design consultation"][i % 5]} (sample line ${i + 1})`,
      qty,
      unit,
      amount: qty * unit,
    };
  });
}

const data = rooms.map((room) => ({ ...room, items: sampleLines(room.name, room.lines) }));
const pages = [data.slice(0, 2), data.slice(2, 4), data.slice(4)];

export default function PdfSample() {
  return (
    <div className="spike-doc">
      {pages.map((pageRooms, pageIndex) => (
        <section className="spike-page" key={pageIndex}>
          <header className="spike-head">
            <img src="/spike/logo.svg" alt="Insides Interior" width={240} height={64} />
            <div style={{ textAlign: "right" }}>
              <h1>Quote</h1>
              <div>Q-SPIKE-0001 · page {pageIndex + 1} of 3</div>
            </div>
          </header>
          {pageRooms.map((room) => (
            <div key={room.name}>
              <h2>{room.name}</h2>
              <table>
                <thead>
                  <tr>
                    <th>Description</th>
                    <th className="num">Qty</th>
                    <th className="num">Unit price</th>
                    <th className="num">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {room.items.map((line) => (
                    <tr key={line.key}>
                      <td>{line.description}</td>
                      <td className="num">{line.qty}</td>
                      <td className="num">{money(line.unit)}</td>
                      <td className="num">{money(line.amount)}</td>
                    </tr>
                  ))}
                  <tr className="spike-total">
                    <td colSpan={3}>Room total</td>
                    <td className="num">{money(room.items.reduce((sum, l) => sum + l.amount, 0))}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ))}
          {pageIndex === 2 && (
            <>
              <h2>Terms</h2>
              <p>
                Sample terms for the phase 0 PDF spike. A 50% deposit is due on approval; the balance is due
                on completion. This document checks fonts, logo, page breaks and selectable text.
              </p>
            </>
          )}
        </section>
      ))}
    </div>
  );
}
