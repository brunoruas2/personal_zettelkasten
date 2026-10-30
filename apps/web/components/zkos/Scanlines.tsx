/** Scanlines + vinheta sobre a tela. O flicker é desligado pelo CSS sob movimento reduzido. */
export function Scanlines({ flicker = true }: { flicker?: boolean }) {
  return <div aria-hidden="true" className="zk-scan absolute inset-0 z-[9]" data-flicker={flicker} />;
}
