export function HeroLogo() {
  return (
    <div className="relative flex h-28 w-28 items-center justify-center">
      <div
        aria-hidden
        className="absolute inset-0 rounded-[24px]"
        style={{
          background:
            'radial-gradient(circle at 30% 30%, rgb(var(--accent) / 0.45), transparent 65%)',
        }}
      />
      <img src="/runhq.svg" alt="" className="relative h-24 w-24 drop-shadow-xl" />
    </div>
  );
}
